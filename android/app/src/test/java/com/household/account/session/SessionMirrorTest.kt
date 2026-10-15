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
        val first = mirror.replace("h", "m", "old", "또니망고네") { }
        val renamed = mirror.replace("h", "m", "new", "익태송희네") { fail("same actor must not purge") }
        assertEquals(first.generation, renamed.generation)
        assertEquals("익태송희네", renamed.householdName)
        mirror.clear { previous ->
            assertEquals(renamed, previous)
            assertNull(mirror.snapshot())
        }
        assertNull(mirror.snapshot())
        assertTrue(mirror.generation() > first.generation)
    }

    @Test fun householdNameIsOptionalInOldSnapshotsAndNeverBorrowedByAnotherSession() = runTest {
        val store = Store()
        val mirror = SessionMirror(store)
        val first = mirror.replace("h1", "m1", "member", "또니망고네") { }
        assertEquals("또니망고네", SessionMirror(store).snapshot()?.householdName)
        val oldJson = org.json.JSONObject(SessionMirrorJson.encode(store.value)).apply {
            getJSONObject("snapshot").remove("householdName")
        }
        assertEquals(first.copy(householdName = null), SessionMirrorJson.decode(oldJson.toString()).snapshot)

        val oldResponse = mirror.replace("h1", "m1", "member") { fail("same actor must not purge") }
        assertNull(oldResponse.householdName)
        mirror.replace("h1", "m1", "member", "또니망고네") { }
        val switched = mirror.replace("h2", "m2", "other") {
            assertNull(mirror.snapshot())
        }
        assertNull(switched.householdName)
        assertNull(SessionMirror(store).snapshot()?.householdName)
    }

    @Test fun authoritativeHouseholdNameMustMatchTheResolvedMembership() {
        fun response(id: String, name: Any?) = mapOf("household" to mapOf("id" to id, "name" to name))
        assertEquals("또니망고네", NativeMembershipResolver.householdName(response("h", " 또니망고네 "), "h"))
        assertNull(NativeMembershipResolver.householdName(response("other", "익태송희네"), "h"))
        assertNull(NativeMembershipResolver.householdName(emptyMap<String, Any>(), "h"))
        assertNull(NativeMembershipResolver.householdName(response("h", "  "), "h"))
        assertNull(NativeMembershipResolver.householdName(response("h", 42), "h"))
    }
}
