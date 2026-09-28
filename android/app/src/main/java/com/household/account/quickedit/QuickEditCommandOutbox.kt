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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

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
    private val completedUpdates = linkedMapOf<String, CompletedQuickEditUpdateFeedback>()
    private val acceptedUpdates = mutableSetOf<String>()
    private val feedbackRevision = MutableStateFlow(0L)
    val updateFeedbackChanges: StateFlow<Long> = feedbackRevision.asStateFlow()

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
                (existing.envelope == envelope || existing.envelope.isLegacyIdentityOf(envelope)) &&
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
            }.also { entries ->
                // 실제 Worker 전달 시작도 영속 예약 성공이 확인된 접수 경계입니다.
                if (acceptedUpdates.addAll(entries.filter { it.envelope.command == HouseholdCommandKind.UPDATE }.map { it.envelope.commandId })) {
                    feedbackRevision.value += 1
                }
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
                is HouseholdCommandResult.Succeeded -> completeEntry(entry.envelope.commandId, result.value)
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
        if (next != entries) {
            store.replace(next)
            feedbackRevision.value += 1
        }
    }

    suspend fun purgeForSessionTransition() = deliveryMutex.withLock {
        mutex.withLock {
            store.clear()
            completedUpdates.clear()
            acceptedUpdates.clear()
            feedbackRevision.value += 1
        }
    }

    suspend fun snapshot(): List<QuickEditCommandOutboxEntry> = mutex.withLock { store.load() }

    /** WorkManager 영속 예약에 성공한 명령만 Web의 낙관적 pending으로 공개합니다. */
    suspend fun acceptUpdateFeedback(scope: CaptureSessionScope, commandId: String? = null) = mutex.withLock {
        val ids = store.load().filter {
            it.scope == scope && it.envelope.command == HouseholdCommandKind.UPDATE &&
                it.deliveryState == QuickEditCommandDeliveryState.PENDING &&
                (commandId == null || it.envelope.commandId == commandId)
        }.map { it.envelope.commandId }
        if (acceptedUpdates.addAll(ids)) feedbackRevision.value += 1
    }

    /** pending과 완료 결과 사이에 빈 구간이 없도록 같은 저장소 mutex로 조회합니다. */
    suspend fun updateFeedback(scope: CaptureSessionScope): List<QuickEditUpdateFeedback> = mutex.withLock {
        pruneCompletedUpdates()
        val entries = store.load().filter { it.scope == scope }
        val activeIds = entries.map { it.envelope.commandId }.toSet()
        completedUpdates.values.filter { it.scope == scope && it.feedback.commandId !in activeIds }.map { it.feedback } +
            entries.mapNotNull {
                if (it.deliveryState == QuickEditCommandDeliveryState.PENDING && it.envelope.commandId !in acceptedUpdates) null
                else it.updateFeedback(if (it.deliveryState == QuickEditCommandDeliveryState.PENDING) "pending" else "failed")
            }
    }

    /** 전달 대기 명령은 ack로 삭제하지 않습니다. Web에 인계한 프로세스 메모리 결과만 정리합니다. */
    suspend fun acknowledgeUpdateFeedback(scope: CaptureSessionScope, commandIds: Set<String>) = mutex.withLock {
        val changed = completedUpdates.entries.removeAll { (id, result) -> id in commandIds && result.scope == scope }
        if (changed) feedbackRevision.value += 1
    }

    suspend fun hasUnrecoverableLossNotificationPending(): Boolean = mutex.withLock {
        store.hasUnrecoverableLossNotificationPending()
    }

    suspend fun acknowledgeUnrecoverableLossNotification() = mutex.withLock {
        store.acknowledgeUnrecoverableLossNotification()
    }

    private fun HouseholdCommandEnvelopeV1.isLegacyIdentityOf(
        submitted: HouseholdCommandEnvelopeV1
    ): Boolean {
        if (command != HouseholdCommandKind.UPDATE && command != HouseholdCommandKind.DELETE) {
            return false
        }
        if (!commandId.startsWith("android:")) return false
        val operationId = commandId.removePrefix("android:")
        // 업그레이드 전 접수된 동일 작업만 인정하며 저장된 envelope와 접수 시각은 바꾸지 않습니다.
        return operationId.isNotBlank() &&
            idempotencyKey == "android-quick-edit:$operationId" &&
            submitted.idempotencyKey == commandId &&
            copy(idempotencyKey = submitted.idempotencyKey) == submitted
    }

    private suspend fun completeEntry(commandId: String, canonical: Any?) = mutex.withLock {
        val entries = store.load()
        val completed = entries.firstOrNull { it.envelope.commandId == commandId }
        val next = entries.filterNot { it.envelope.commandId == commandId }
        if (next != entries) {
            store.replace(next)
            acceptedUpdates.remove(commandId)
            completed?.let { entry ->
                if (entry.envelope.command == HouseholdCommandKind.DELETE || entry.envelope.command == HouseholdCommandKind.SPLIT) {
                    completedUpdates.entries.removeAll { it.value.scope == entry.scope && it.value.feedback.transactionId == entry.transactionId }
                }
                entry.updateFeedback("succeeded", canonical)?.let { rememberCompleted(entry.scope, it) }
            }
            feedbackRevision.value += 1
        }
    }

    private suspend fun updateEntry(
        commandId: String,
        transform: (QuickEditCommandOutboxEntry) -> QuickEditCommandOutboxEntry
    ) = mutex.withLock {
        val entries = store.load()
        val next = entries.map { entry ->
            if (entry.envelope.commandId == commandId) transform(entry) else entry
        }
        if (next != entries) {
            store.replace(next)
            next.firstOrNull { it.envelope.commandId == commandId && it.deliveryState == QuickEditCommandDeliveryState.NEEDS_ATTENTION }?.let { entry ->
                acceptedUpdates.remove(commandId)
                entry.updateFeedback("failed")?.let { rememberCompleted(entry.scope, it) }
            }
            feedbackRevision.value += 1
        }
    }

    private fun rememberCompleted(scope: CaptureSessionScope, feedback: QuickEditUpdateFeedback) {
        completedUpdates[feedback.commandId] = CompletedQuickEditUpdateFeedback(scope, feedback, nowEpochMillis())
        pruneCompletedUpdates()
    }

    private fun pruneCompletedUpdates() {
        val now = nowEpochMillis()
        completedUpdates.entries.removeAll { now - it.value.completedAtEpochMillis >= MAX_RETRY_WINDOW_MILLIS }
        while (completedUpdates.size > MAX_COMPLETED_UPDATE_FEEDBACK) {
            completedUpdates.remove(completedUpdates.keys.first())
        }
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
        internal const val MAX_COMPLETED_UPDATE_FEEDBACK = 256
        private const val COMMAND_TIMEOUT_MILLIS = 30_000L
        private const val RETRY_WINDOW_EXPIRED = "QUICK_EDIT_RETRY_WINDOW_EXPIRED"
        private const val VERSION_CONFLICT = "VERSION_MISMATCH"
    }
}
