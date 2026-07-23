package com.household.account.quickedit

import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.paymentcapture.CaptureQuickEditSnapshot
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class QuickEditQueueEntry(
    val scope: CaptureSessionScope,
    val transactionId: String,
    val sequence: Long,
    val enqueuedAtEpochMillis: Long,
    val snapshot: CaptureQuickEditSnapshot? = null,
    val observationId: String? = null
)

data class QuickEditQueueState(
    val nextSequence: Long = 1L,
    val activeTransactionId: String? = null,
    val entries: List<QuickEditQueueEntry> = emptyList()
)

data class QuickEditEnqueueAndAcquireResult(
    val accepted: Boolean,
    val acquiredHead: QuickEditQueueEntry? = null
)

interface QuickEditQueueStore {
    fun load(): QuickEditQueueState
    fun replace(state: QuickEditQueueState)
    fun clear()
}

class QuickEditPendingQueue(
    private val store: QuickEditQueueStore,
    private val nowEpochMillis: () -> Long = System::currentTimeMillis
) {
    private val mutex = Mutex()

    suspend fun recoverAfterProcessStart() = mutex.withLock {
        val state = store.load()
        if (state.activeTransactionId != null) {
            store.replace(state.copy(activeTransactionId = null))
        }
    }

    suspend fun enqueue(
        scope: CaptureSessionScope,
        transactionId: String,
        snapshot: CaptureQuickEditSnapshot? = null,
        observationId: String? = null
    ): Boolean = mutex.withLock {
        if (!scope.isUsable || transactionId.isBlank()) return@withLock false
        val state = sanitizeScope(store.load(), scope)
        val updated = enqueueState(state, scope, transactionId, snapshot, observationId)
        if (updated != state) store.replace(updated)
        true
    }

    /**
     * 새 Quick Edit을 durable queue에 넣는 쓰기와 idle head lease를 한 번의
     * 암호화 저장으로 합칩니다. 서버 snapshot이 있으면 호출자가 곧바로 화면을
     * 열 수 있어 별도의 queue 재조회와 lease 저장을 기다리지 않습니다.
     */
    suspend fun enqueueAndAcquireIfIdle(
        scope: CaptureSessionScope,
        transactionId: String,
        snapshot: CaptureQuickEditSnapshot? = null,
        observationId: String? = null
    ): QuickEditEnqueueAndAcquireResult = mutex.withLock {
        if (!scope.isUsable || transactionId.isBlank()) {
            return@withLock QuickEditEnqueueAndAcquireResult(accepted = false)
        }
        val state = sanitizeScope(store.load(), scope)
        val enqueued = enqueueState(state, scope, transactionId, snapshot, observationId)
        val head = if (enqueued.activeTransactionId == null) {
            enqueued.entries.minByOrNull { it.sequence }
        } else {
            null
        }
        val committed = if (head == null) {
            enqueued
        } else {
            enqueued.copy(activeTransactionId = head.transactionId)
        }
        if (committed != state) store.replace(committed)
        QuickEditEnqueueAndAcquireResult(
            accepted = true,
            acquiredHead = head
        )
    }

    suspend fun acquireHead(scope: CaptureSessionScope): QuickEditQueueEntry? = mutex.withLock {
        val state = sanitizeScope(store.load(), scope)
        if (state.activeTransactionId != null) return@withLock null
        val head = state.entries.minByOrNull { it.sequence } ?: return@withLock null
        store.replace(state.copy(activeTransactionId = head.transactionId))
        head
    }

    suspend fun releaseLease(scope: CaptureSessionScope, transactionId: String) = mutex.withLock {
        val state = sanitizeScope(store.load(), scope)
        if (state.activeTransactionId == transactionId) {
            store.replace(state.copy(activeTransactionId = null))
        }
    }

    suspend fun complete(scope: CaptureSessionScope, transactionId: String) = mutex.withLock {
        val state = sanitizeScope(store.load(), scope)
        store.replace(
            state.copy(
                activeTransactionId = null,
                entries = state.entries.filterNot { it.transactionId == transactionId }
            )
        )
    }

    suspend fun purge() = mutex.withLock { store.clear() }

    fun snapshot(): QuickEditQueueState = store.load()

    private fun enqueueState(
        state: QuickEditQueueState,
        scope: CaptureSessionScope,
        transactionId: String,
        snapshot: CaptureQuickEditSnapshot?,
        observationId: String?
    ): QuickEditQueueState {
        val acceptedSnapshot = snapshot?.takeIf { it.transactionId == transactionId }
        val acceptedObservationId = observationId?.takeIf { it.isNotBlank() }
        val existingIndex = state.entries.indexOfFirst { it.transactionId == transactionId }
        if (existingIndex >= 0) {
            val existing = state.entries[existingIndex]
            val updatedEntry = existing.copy(
                snapshot = existing.snapshot ?: acceptedSnapshot,
                observationId = existing.observationId ?: acceptedObservationId
            )
            if (updatedEntry == existing) return state
            val updated = state.entries.toMutableList()
            updated[existingIndex] = updatedEntry
            return state.copy(entries = updated)
        }
        val entry = QuickEditQueueEntry(
            scope = scope,
            transactionId = transactionId,
            sequence = state.nextSequence,
            enqueuedAtEpochMillis = nowEpochMillis(),
            snapshot = acceptedSnapshot,
            observationId = acceptedObservationId
        )
        return state.copy(
            nextSequence = state.nextSequence + 1L,
            entries = state.entries + entry
        )
    }

    private fun sanitizeScope(
        state: QuickEditQueueState,
        scope: CaptureSessionScope
    ): QuickEditQueueState {
        val scopedEntries = if (scope.isUsable) {
            state.entries.filter { it.scope == scope }
        } else {
            emptyList()
        }
        val active = state.activeTransactionId?.takeIf { id ->
            scopedEntries.any { it.transactionId == id }
        }
        val sanitized = state.copy(activeTransactionId = active, entries = scopedEntries)
        if (sanitized != state) store.replace(sanitized)
        return sanitized
    }
}
