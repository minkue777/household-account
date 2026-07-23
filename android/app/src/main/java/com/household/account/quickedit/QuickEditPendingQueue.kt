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
        val acceptedSnapshot = snapshot?.takeIf { it.transactionId == transactionId }
        val acceptedObservationId = observationId?.takeIf { it.isNotBlank() }
        val state = sanitizeScope(store.load(), scope)
        val existingIndex = state.entries.indexOfFirst { it.transactionId == transactionId }
        if (existingIndex >= 0) {
            val existing = state.entries[existingIndex]
            val updatedEntry = existing.copy(
                snapshot = existing.snapshot ?: acceptedSnapshot,
                observationId = existing.observationId ?: acceptedObservationId
            )
            if (updatedEntry != existing) {
                val updated = state.entries.toMutableList()
                updated[existingIndex] = updatedEntry
                store.replace(state.copy(entries = updated))
            }
            return@withLock true
        }
        val entry = QuickEditQueueEntry(
            scope = scope,
            transactionId = transactionId,
            sequence = state.nextSequence,
            enqueuedAtEpochMillis = nowEpochMillis(),
            snapshot = acceptedSnapshot,
            observationId = acceptedObservationId
        )
        store.replace(
            state.copy(
                nextSequence = state.nextSequence + 1L,
                entries = state.entries + entry
            )
        )
        true
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
