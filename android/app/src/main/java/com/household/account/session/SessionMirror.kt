package com.household.account.session

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class SessionMirrorSnapshot(
    val householdId: String,
    val memberId: String,
    val memberName: String,
    val generation: Long,
    val sourceVersion: Int = 1,
    val updatedAtEpochMillis: Long
)
data class SessionTransitionJournal(val fromGeneration: Long, val toGeneration: Long)
data class SessionMirrorState(
    val schemaVersion: Int = 1,
    val generation: Long = 0,
    val snapshot: SessionMirrorSnapshot? = null,
    val transition: SessionTransitionJournal? = null
)
interface SessionMirrorStore {
    fun load(): SessionMirrorState
    fun replace(state: SessionMirrorState)
}

/** Authoritative login, membership recovery and logout share this transition boundary. */
class SessionMirror(private val store: SessionMirrorStore, private val now: () -> Long = System::currentTimeMillis) {
    private val transitionMutex = Mutex()
    @Volatile private var state = store.load().let { loaded ->
        // A surviving journal cannot restore either actor before successful cleanup.
        if (loaded.transition == null) loaded else loaded.copy(snapshot = null).also(store::replace)
    }
    fun snapshot(): SessionMirrorSnapshot? = state.let { if (it.transition == null) it.snapshot else null }
    fun generation(): Long = state.generation

    suspend fun replace(householdId: String, memberId: String, memberName: String, purge: suspend (SessionMirrorSnapshot?) -> Unit): SessionMirrorSnapshot = transitionMutex.withLock {
        require(householdId.isNotBlank() && memberId.isNotBlank() && memberName.isNotBlank())
        val current = state.snapshot
        if (state.transition == null && current?.householdId == householdId && current.memberId == memberId) {
            val renamed = current.copy(memberName = memberName, updatedAtEpochMillis = now())
            commit(state.copy(snapshot = renamed))
            return@withLock renamed
        }
        val next = SessionMirrorSnapshot(householdId, memberId, memberName, nextGeneration(), updatedAtEpochMillis = now())
        transition(next, purge)
        next
    }
    suspend fun clear(purge: suspend (SessionMirrorSnapshot?) -> Unit) = transitionMutex.withLock { transition(null, purge) }
    private fun nextGeneration(): Long = Math.addExact(state.generation, 1L)
    private suspend fun transition(next: SessionMirrorSnapshot?, purge: suspend (SessionMirrorSnapshot?) -> Unit) {
        val previous = state
        val generation = next?.generation ?: nextGeneration()
        commit(previous.copy(transition = SessionTransitionJournal(previous.generation, generation)))
        try {
            purge(previous.snapshot)
        } catch (error: Exception) {
            // If rollback storage fails, the journal still makes next startup fail closed.
            commit(previous)
            throw error
        }
        // Snapshot and removal of the journal are one encrypted storage commit.
        commit(SessionMirrorState(generation = generation, snapshot = next))
    }
    private fun commit(next: SessionMirrorState) {
        store.replace(next)
        state = next
    }
}
