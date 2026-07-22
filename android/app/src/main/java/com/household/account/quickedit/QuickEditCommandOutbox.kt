package com.household.account.quickedit

import com.household.account.ledger.HouseholdCommandClient
import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.ledger.HouseholdCommandResult
import com.household.account.paymentcapture.CaptureSessionScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

enum class QuickEditCommandDeliveryState {
    PENDING,
    NEEDS_ATTENTION
}

internal val QUICK_EDIT_DELIVERABLE_LEDGER_COMMANDS = setOf(
    HouseholdCommandKind.UPDATE,
    HouseholdCommandKind.DELETE,
    HouseholdCommandKind.SPLIT,
    HouseholdCommandKind.REQUEST_HOUSEHOLD_NOTIFICATION
)

data class QuickEditCommandOutboxEntry(
    val scope: CaptureSessionScope,
    val transactionId: String,
    val envelope: HouseholdCommandEnvelopeV1,
    val queuedAtEpochMillis: Long,
    val deliveryState: QuickEditCommandDeliveryState = QuickEditCommandDeliveryState.PENDING,
    val terminalCode: String? = null,
    val terminalAtEpochMillis: Long? = null,
    val failureNotificationPending: Boolean = false
)

interface QuickEditCommandOutboxStore {
    fun load(): List<QuickEditCommandOutboxEntry>
    fun replace(entries: List<QuickEditCommandOutboxEntry>)
    fun clear()
    fun hasUnrecoverableLossNotificationPending(): Boolean = false
    fun acknowledgeUnrecoverableLossNotification() = Unit
}

data class QuickEditCommandFlushOutcome(
    val pendingCount: Int,
    val failuresAwaitingNotification: List<QuickEditCommandOutboxEntry>,
    val failureNotificationPendingCount: Int = failuresAwaitingNotification.size
) {
    val requiresWorkerRetry: Boolean
        get() = pendingCount > 0 || failureNotificationPendingCount > 0
}

/**
 * QuickEdit 화면과 서버 왕복을 분리하는 transactional outbox입니다.
 *
 * Activity는 [enqueue]의 암호화 commit이 끝난 뒤 닫을 수 있습니다. 네트워크 재시도는 저장된
 * envelope 자체를 사용하므로 commandId와 idempotencyKey가 process 재시작 뒤에도 바뀌지 않습니다.
 */
class QuickEditCommandOutbox(
    private val store: QuickEditCommandOutboxStore,
    private val nowEpochMillis: () -> Long = System::currentTimeMillis
) {
    private val mutex = Mutex()
    private val deliveryMutex = Mutex()

    suspend fun enqueue(
        scope: CaptureSessionScope,
        transactionId: String,
        envelope: HouseholdCommandEnvelopeV1
    ): Boolean = mutex.withLock {
        if (
            !scope.isUsable ||
            transactionId.isBlank() ||
            envelope.householdId != scope.householdId ||
            envelope.payload["transactionId"] != transactionId ||
            envelope.command !in QUICK_EDIT_DELIVERABLE_LEDGER_COMMANDS
        ) {
            return@withLock false
        }

        val entries = store.load()
        val existing = entries.firstOrNull { it.envelope.commandId == envelope.commandId }
        if (existing != null) {
            return@withLock existing.scope == scope &&
                existing.transactionId == transactionId &&
                existing.envelope == envelope &&
                existing.deliveryState == QuickEditCommandDeliveryState.PENDING
        }

        store.replace(
            entries + QuickEditCommandOutboxEntry(
                scope = scope,
                transactionId = transactionId,
                envelope = envelope,
                queuedAtEpochMillis = nowEpochMillis()
            )
        )
        true
    }

    suspend fun flush(
        currentScope: CaptureSessionScope,
        client: HouseholdCommandClient
    ): QuickEditCommandFlushOutcome = deliveryMutex.withLock {
        // 네트워크 왕복 중에는 저장소 mutex를 잡지 않습니다. 앞 명령의 전송이
        // 느리더라도 다음 QuickEdit의 outbox commit을 막지 않습니다.
        val candidates = mutex.withLock {
            store.load().filter {
                it.deliveryState == QuickEditCommandDeliveryState.PENDING &&
                    it.scope == currentScope &&
                    currentScope.isUsable
            }
        }

        for (entry in candidates) {
            val now = nowEpochMillis()
            if (now - entry.queuedAtEpochMillis >= MAX_RETRY_WINDOW_MILLIS) {
                updateEntry(entry.envelope.commandId) { current ->
                    current.toNeedsAttention(RETRY_WINDOW_EXPIRED, now)
                }
                continue
            }

            val result = try {
                withTimeoutOrNull(COMMAND_TIMEOUT_MILLIS) {
                    client.execute(entry.envelope)
                } ?: HouseholdCommandResult.RetryableFailure("QUICK_EDIT_COMMAND_TIMEOUT")
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                break
            }

            when (result) {
                is HouseholdCommandResult.Succeeded -> removeEntry(entry.envelope.commandId)
                is HouseholdCommandResult.RetryableFailure -> break
                is HouseholdCommandResult.Conflict -> {
                    updateEntry(entry.envelope.commandId) { current ->
                        current.toNeedsAttention(VERSION_CONFLICT, now)
                    }
                }
                is HouseholdCommandResult.Rejected -> {
                    updateEntry(entry.envelope.commandId) { current ->
                        current.toNeedsAttention(result.code, now)
                    }
                }
                is HouseholdCommandResult.ContractFailure -> {
                    updateEntry(entry.envelope.commandId) { current ->
                        current.toNeedsAttention(result.code, now)
                    }
                }
            }
        }

        val current = mutex.withLock { store.load() }
        QuickEditCommandFlushOutcome(
            pendingCount = current.count {
                it.deliveryState == QuickEditCommandDeliveryState.PENDING &&
                    it.scope == currentScope
            },
            failuresAwaitingNotification = current.filter {
                it.deliveryState == QuickEditCommandDeliveryState.NEEDS_ATTENTION &&
                    it.scope == currentScope &&
                    it.failureNotificationPending
            }
        )
    }

    suspend fun markFailureNotificationDelivered(commandId: String) = mutex.withLock {
        val entries = store.load()
        // Terminal payload는 알림 전달 뒤 더 이상 복구할 수 없으므로 제거합니다.
        // 민감한 거래 payload가 72시간 정책을 넘어 기기에 남지 않게 합니다.
        val next = entries.filterNot {
            it.envelope.commandId == commandId && it.failureNotificationPending
        }
        if (next != entries) store.replace(next)
    }

    suspend fun purgeForSessionTransition() = deliveryMutex.withLock {
        mutex.withLock { store.clear() }
    }

    suspend fun snapshot(): List<QuickEditCommandOutboxEntry> = mutex.withLock { store.load() }

    suspend fun hasUnrecoverableLossNotificationPending(): Boolean = mutex.withLock {
        store.hasUnrecoverableLossNotificationPending()
    }

    suspend fun acknowledgeUnrecoverableLossNotification() = mutex.withLock {
        store.acknowledgeUnrecoverableLossNotification()
    }

    private suspend fun removeEntry(commandId: String) = mutex.withLock {
        val entries = store.load()
        val next = entries.filterNot { it.envelope.commandId == commandId }
        if (next != entries) store.replace(next)
    }

    private suspend fun updateEntry(
        commandId: String,
        transform: (QuickEditCommandOutboxEntry) -> QuickEditCommandOutboxEntry
    ) = mutex.withLock {
        val entries = store.load()
        val next = entries.map { entry ->
            if (entry.envelope.commandId == commandId) transform(entry) else entry
        }
        if (next != entries) store.replace(next)
    }

    private fun QuickEditCommandOutboxEntry.toNeedsAttention(
        code: String,
        failedAt: Long
    ): QuickEditCommandOutboxEntry = copy(
        deliveryState = QuickEditCommandDeliveryState.NEEDS_ATTENTION,
        terminalCode = code,
        terminalAtEpochMillis = failedAt,
        failureNotificationPending = true
    )

    companion object {
        const val MAX_RETRY_WINDOW_MILLIS = 72L * 60L * 60L * 1_000L
        private const val COMMAND_TIMEOUT_MILLIS = 30_000L
        private const val RETRY_WINDOW_EXPIRED = "QUICK_EDIT_RETRY_WINDOW_EXPIRED"
        private const val VERSION_CONFLICT = "VERSION_MISMATCH"
    }
}
