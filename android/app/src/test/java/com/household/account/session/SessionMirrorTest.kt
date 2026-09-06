package com.household.account.session

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class SessionMirrorTest {
    private class Store(var value: SessionMirrorState = SessionMirrorState()) : SessionMirrorStore {
        var failNextCommit = false
        override fun load() = SessionMirrorJson.decode(SessionMirrorJson.encode(value))
        override fun replace(state: SessionMirrorState) {
            if (failNextCommit) { failNextCommit = false; error("storage failed") }
            value = SessionMirrorJson.decode(SessionMirrorJson.encode(state))
        }
    }

    @Test fun newActorIsInvisibleUntilPurgeCompletesAndFailureRetainsPreviousActor() = runTest {
        val store = Store()
        val mirror = SessionMirror(store) { 10L }
        val previous = mirror.replace("h1", "m1", "name") { }
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val change = async { runCatching { mirror.replace("h2", "m2", "other") {
            assertEquals(previous, it)
            entered.complete(Unit)
            release.await()
            error("purge failed")
        } } }
        entered.await()
        assertNull(mirror.snapshot())
        assertNotNull(store.value.transition)
        release.complete(Unit)
        assertTrue(change.await().isFailure)
        assertEquals(previous, mirror.snapshot())
        assertNull(store.value.transition)
    }

    @Test fun processDeathAfterPurgeBeforeCommitRecoversWithoutEitherActor() = runTest {
        val store = Store()
        val mirror = SessionMirror(store) { 10L }
        mirror.replace("h1", "m1", "name") { }
        try {
            mirror.replace("h2", "m2", "other") { store.failNextCommit = true }
            fail("commit must fail")
        } catch (_: IllegalStateException) { }
        assertNotNull(store.value.transition)
        val restarted = SessionMirror(store)
        assertNull(restarted.snapshot())
        var purged = false
        val restored = restarted.replace("h2", "m2", "other") { purged = true }
        assertTrue(purged)
        assertEquals(restored, restarted.snapshot())
        assertNull(store.value.transition)
    }

    @Test fun nameChangeKeepsStableGenerationAndLogoutPurgesBeforeClearing() = runTest {
        val mirror = SessionMirror(Store()) { 10L }
        val first = mirror.replace("h", "m", "old") { }
        val renamed = mirror.replace("h", "m", "new") { fail("same actor must not purge") }
        assertEquals(first.generation, renamed.generation)
        mirror.clear { previous ->
            assertEquals(renamed, previous)
            assertNull(mirror.snapshot())
        }
        assertNull(mirror.snapshot())
        assertTrue(mirror.generation() > first.generation)
    }
}
