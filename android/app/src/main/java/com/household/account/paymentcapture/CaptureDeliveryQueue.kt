package com.household.account.paymentcapture

import kotlinx.coroutines.CancellationException
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
    val observationId: String,
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
    val aggregateVersion: Int,
    val tags: List<String> = emptyList()
)

data class CaptureFlushOutcome(
    val followUps: List<CaptureDeliveryFollowUp>,
    val retainedCount: Int
)

internal sealed interface CaptureBatchEnqueueResult {
    data class Accepted(
        val persistedEnvelopes: List<CaptureDeliveryEnvelope>
    ) : CaptureBatchEnqueueResult

    data class PayloadConflict(
        val observationId: String
    ) : CaptureBatchEnqueueResult

    data object Rejected : CaptureBatchEnqueueResult
}

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
                observationId = envelope.observationId,
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
    private val deliveryMutex = Mutex()
    private val purgedScopes = mutableSetOf<CaptureSessionScope>()

    /** 모든 후보를 한 번의 암호화 store 교체로 기록한 뒤에만 원격 제출을 허용합니다. */
    internal suspend fun enqueueAll(
        scope: CaptureSessionScope,
        envelopes: List<CaptureDeliveryEnvelope>
    ): CaptureBatchEnqueueResult = mutex.withLock {
        if (!scope.isUsable || scope in purgedScopes || envelopes.isEmpty()) {
            return@withLock CaptureBatchEnqueueResult.Rejected
        }
        val entries = store.load().filterNot { isExpired(it) }
        val existingByObservationId = linkedMapOf<String, CaptureDeliveryEnvelope>()
        entries.forEach { entry ->
            val observationId = entry.envelope.observationId
            val existing = existingByObservationId[observationId]
            if (existing != null && existing.toMap() != entry.envelope.toMap()) {
                return@withLock CaptureBatchEnqueueResult.PayloadConflict(observationId)
            }
            existingByObservationId.putIfAbsent(observationId, entry.envelope)
        }

        val uniqueNewEnvelopes = linkedMapOf<String, CaptureDeliveryEnvelope>()
        envelopes.forEach { envelope ->
            val observationId = envelope.observationId
            val canonical = existingByObservationId[observationId]
                ?: uniqueNewEnvelopes[observationId]
            if (canonical != null) {
                if (canonical.toMap() != envelope.toMap()) {
                    return@withLock CaptureBatchEnqueueResult.PayloadConflict(observationId)
                }
                return@forEach
            }
            uniqueNewEnvelopes[observationId] = envelope
        }
        val persistedEnvelopes = uniqueNewEnvelopes.values.toList()
        if (persistedEnvelopes.isEmpty()) {
            return@withLock CaptureBatchEnqueueResult.Accepted(emptyList())
        }

        val queuedAtEpochMillis = nowEpochMillis()
        store.replace(
            entries + persistedEnvelopes.map { envelope ->
                QueuedCapture(scope, envelope, queuedAtEpochMillis)
            }
        )
        CaptureBatchEnqueueResult.Accepted(persistedEnvelopes)
    }

    suspend fun flush(
        currentScope: CaptureSessionScope,
        client: CaptureSubmissionClient,
        beforeCommitFollowUps: suspend (List<CaptureDeliveryFollowUp>) -> Unit = {}
    ): CaptureFlushOutcome = deliveryMutex.withLock {
        val pending = mutex.withLock {
            if (!currentScope.isUsable || currentScope in purgedScopes) emptyList()
            else {
                val stored = store.load()
                val active = stored.filter { it.scope == currentScope && !isExpired(it) }
                if (active.size != stored.size) store.replace(active)
                active
            }
        }
        val followUps = mutableListOf<CaptureDeliveryFollowUp>()
        for (entry in pending) {
            val canSubmit = mutex.withLock {
                currentScope !in purgedScopes && !isExpired(entry) && entry in store.load()
            }
            if (!canSubmit) continue
            try {
                // Delivery is serialized, but incoming journal writes and logout never wait for HTTP.
                val receipt = client.submit(entry.envelope)
                mutex.withLock commit@ {
                    val current = store.load()
                    if (currentScope in purgedScopes || isExpired(entry) || entry !in current) return@commit
                    val decision = evaluateCaptureReceipt(entry.envelope, receipt, entry.terminalBranches)
                    // Persist QuickEdit first. Its transactionId dedup covers a crash between stores.
                    beforeCommitFollowUps(decision.followUps)
                    store.replace(current.mapNotNull {
                        if (it != entry) it
                        else if (decision.completed) null
                        else it.copy(terminalBranches = decision.terminalBranches)
                    })
                    followUps += decision.followUps
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // The original journal entry remains retryable after transport or local commit failure.
            }
        }
        mutex.withLock { CaptureFlushOutcome(followUps, store.load().size) }
    }

    suspend fun purgeForSessionTransition(previousScope: CaptureSessionScope? = null) = mutex.withLock {
        val scopes = store.load().map { it.scope }
        store.clear()
        purgedScopes.addAll(scopes)
        previousScope?.let(purgedScopes::add)
    }

    suspend fun resumeAfterFailedTransition(scope: CaptureSessionScope) = mutex.withLock {
        purgedScopes.remove(scope)
    }

    fun snapshot(): List<QueuedCapture> = store.load()

    private fun isExpired(entry: QueuedCapture): Boolean =
        nowEpochMillis() - entry.queuedAtEpochMillis > MAX_RETENTION_MILLIS

    companion object {
        const val MAX_RETENTION_MILLIS = 72L * 60L * 60L * 1_000L
    }
}
