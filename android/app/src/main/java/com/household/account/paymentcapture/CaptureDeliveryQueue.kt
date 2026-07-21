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
    val envelope: CaptureEnvelopeV1,
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
    val envelope: CaptureEnvelopeV1
)

data class CaptureFlushOutcome(
    val followUps: List<CaptureDeliveryFollowUp>,
    val retainedCount: Int
)

/**
 * 원문 없는 CaptureEnvelope만 저장하며, 성공한 branch는 재실행 후속 효과에서 제외합니다.
 * 서버 receipt의 retryable branch만 최대 72시간 유지합니다.
 */
class CaptureDeliveryQueue(
    private val store: CaptureQueueStore,
    private val nowEpochMillis: () -> Long = System::currentTimeMillis
) {
    private val mutex = Mutex()

    suspend fun enqueue(scope: CaptureSessionScope, envelope: CaptureEnvelopeV1): Boolean =
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
        client: CaptureSubmissionClient
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

            val terminal = entry.terminalBranches.toMutableSet()
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
                        envelope = entry.envelope
                    )
                }
            }
            receipt.balance?.takeUnless { it.retryable }?.let {
                terminal += CaptureBranch.BALANCE
            }

            val required = buildSet {
                if (entry.envelope.paymentObservation != null) add(CaptureBranch.PAYMENT)
                if (entry.envelope.balanceObservation != null) add(CaptureBranch.BALANCE)
            }
            if (!terminal.containsAll(required)) {
                retained += entry.copy(terminalBranches = terminal)
            }
        }

        store.replace(retained)
        CaptureFlushOutcome(followUps, retained.size)
    }

    suspend fun purgeForSessionTransition() = mutex.withLock {
        store.clear()
    }

    fun snapshot(): List<QueuedCapture> = store.load()

    private fun isExpired(entry: QueuedCapture): Boolean =
        nowEpochMillis() - entry.queuedAtEpochMillis > MAX_RETENTION_MILLIS

    companion object {
        const val MAX_RETENTION_MILLIS = 72L * 60L * 60L * 1_000L
    }
}
