package com.household.account.paymentcapture

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class CaptureSessionScope(
    val householdId: String,
    val memberId: String,
    val sessionGeneration: Long
) {
    val isUsable: Boolean
        get() = householdId.isNotBlank() && memberId.isNotBlank() && sessionGeneration > 0L
}

enum class CaptureBranch { PAYMENT, BALANCE }

data class QueuedCapture(
    val scope: CaptureSessionScope,
    val envelope: CaptureDeliveryEnvelope,
    val queuedAtEpochMillis: Long,
    val terminalBranches: Set<CaptureBranch> = emptySet()
)

interface CaptureQueueStore {
    fun load(): List<QueuedCapture>
    fun replace(entries: List<QueuedCapture>)
    fun clear()
}

data class CaptureDeliveryFollowUp(
    val transactionId: String,
    val aggregateVersion: Int,
    val quickEditSnapshot: CaptureQuickEditSnapshot? = null
)

data class CaptureQuickEditSnapshot(
    val transactionId: String,
    val merchant: String,
    val amountInWon: Int,
    val accountingDate: String,
    val localTime: String,
    val categoryId: String,
    val memo: String,
    val aggregateVersion: Int
)

data class CaptureFlushOutcome(
    val followUps: List<CaptureDeliveryFollowUp>,
    val retainedCount: Int
)

internal data class CaptureReceiptDecision(
    val followUps: List<CaptureDeliveryFollowUp>,
    val terminalBranches: Set<CaptureBranch>,
    val completed: Boolean
)

internal fun evaluateCaptureReceipt(
    envelope: CaptureDeliveryEnvelope,
    receipt: CaptureSubmissionReceipt,
    previouslyTerminal: Set<CaptureBranch> = emptySet()
): CaptureReceiptDecision {
    val terminal = previouslyTerminal.toMutableSet()
    val followUps = mutableListOf<CaptureDeliveryFollowUp>()
    receipt.transaction?.takeUnless { it.retryable }?.let { transaction ->
        val wasPending = CaptureBranch.PAYMENT !in terminal
        terminal += CaptureBranch.PAYMENT
        if (
            wasPending &&
            transaction.kind.equals("created", ignoreCase = true) &&
            !transaction.resourceId.isNullOrBlank()
        ) {
            followUps += CaptureDeliveryFollowUp(
                transactionId = transaction.resourceId,
                aggregateVersion = checkNotNull(transaction.aggregateVersion) {
                    "created transaction receipt must include aggregateVersion"
                },
                quickEditSnapshot = transaction.quickEditSnapshot
            )
        }
    }
    receipt.balance?.takeUnless { it.retryable }?.let {
        terminal += CaptureBranch.BALANCE
    }

    val completed = when (envelope) {
        is RawNotificationEnvelopeV1 -> receipt.completion == "terminal"
        is CaptureEnvelopeV1 -> {
            val required = buildSet {
                if (envelope.paymentObservation != null) add(CaptureBranch.PAYMENT)
                if (envelope.balanceObservation != null) add(CaptureBranch.BALANCE)
            }
            terminal.containsAll(required)
        }
    }
    return CaptureReceiptDecision(followUps, terminal, completed)
}

/**
 * 새 APK의 raw notification과 전환 전 APK의 CaptureEnvelope를 같은 암호화 Queue에서 전달합니다.
 * 서버에서 이미 성공한 branch는 재실행 후속 효과에서 제외하고 retryable entry만 최대 72시간 유지합니다.
 */
class CaptureDeliveryQueue(
    private val store: CaptureQueueStore,
    private val nowEpochMillis: () -> Long = System::currentTimeMillis
) {
    private val mutex = Mutex()

    suspend fun enqueue(scope: CaptureSessionScope, envelope: CaptureDeliveryEnvelope): Boolean =
        mutex.withLock {
            if (!scope.isUsable) return@withLock false
            val entries = store.load().filterNot { isExpired(it) }.toMutableList()
            if (entries.any { it.envelope.observationId == envelope.observationId }) {
                return@withLock true
            }
            entries += QueuedCapture(scope, envelope, nowEpochMillis())
            store.replace(entries)
            true
        }

    suspend fun flush(
        currentScope: CaptureSessionScope,
        client: CaptureSubmissionClient,
        beforeCommitFollowUps: suspend (List<CaptureDeliveryFollowUp>) -> Unit = {}
    ): CaptureFlushOutcome = mutex.withLock {
        val retained = mutableListOf<QueuedCapture>()
        val followUps = mutableListOf<CaptureDeliveryFollowUp>()

        for (entry in store.load()) {
            if (isExpired(entry) || entry.scope != currentScope || !currentScope.isUsable) {
                continue
            }

            val receipt = try {
                client.submit(entry.envelope)
            } catch (_: Exception) {
                retained += entry
                continue
            }

            val decision = evaluateCaptureReceipt(
                envelope = entry.envelope,
                receipt = receipt,
                previouslyTerminal = entry.terminalBranches
            )
            followUps += decision.followUps
            if (!decision.completed) {
                retained += entry.copy(terminalBranches = decision.terminalBranches)
            }
        }

        // 두 로컬 저장소를 하나의 transaction으로 묶을 수 없으므로 QuickEdit FIFO를
        // 먼저 내구화하고, 재실행 중복은 transactionId dedup으로 흡수합니다.
        beforeCommitFollowUps(followUps)
        store.replace(retained)
        CaptureFlushOutcome(followUps, retained.size)
    }

    suspend fun purgeForSessionTransition() = mutex.withLock {
        store.clear()
    }

    suspend fun retainAfterAttempt(
        scope: CaptureSessionScope,
        envelope: CaptureDeliveryEnvelope,
        terminalBranches: Set<CaptureBranch>
    ): Boolean = mutex.withLock {
        if (!scope.isUsable) return@withLock false
        val entries = store.load().filterNot { isExpired(it) }.toMutableList()
        val index = entries.indexOfFirst {
            it.envelope.observationId == envelope.observationId
        }
        if (index >= 0) {
            val current = entries[index]
            entries[index] = current.copy(
                terminalBranches = current.terminalBranches + terminalBranches
            )
        } else {
            entries += QueuedCapture(
                scope = scope,
                envelope = envelope,
                queuedAtEpochMillis = nowEpochMillis(),
                terminalBranches = terminalBranches
            )
        }
        store.replace(entries)
        true
    }

    suspend fun completeAfterAttempt(
        scope: CaptureSessionScope,
        envelope: CaptureDeliveryEnvelope
    ): Boolean = mutex.withLock {
        if (!scope.isUsable) return@withLock false
        val current = store.load()
        val retained = current.filterNot {
            it.scope == scope && it.envelope.observationId == envelope.observationId
        }
        store.replace(retained)
        true
    }

    fun snapshot(): List<QueuedCapture> = store.load()

    private fun isExpired(entry: QueuedCapture): Boolean =
        nowEpochMillis() - entry.queuedAtEpochMillis > MAX_RETENTION_MILLIS

    companion object {
        const val MAX_RETENTION_MILLIS = 72L * 60L * 60L * 1_000L
    }
}
