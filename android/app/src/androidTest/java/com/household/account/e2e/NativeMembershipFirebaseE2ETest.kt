package com.household.account.e2e

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.household.account.session.AndroidSessionMirrorStore
import com.household.account.session.NativeMembershipResolution
import com.household.account.session.NativeMembershipResolver
import com.household.account.util.HouseholdPreferences
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real Auth/Functions response must carry the name through the Native resolver into encrypted storage. */
@FirebaseEmulatorE2E
@RunWith(AndroidJUnit4::class)
class NativeMembershipFirebaseE2ETest {
    @Test fun legacyEmbeddedMembersStillPersistHouseholdNameFromServerResolution() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val fixture = JSONObject(String(Base64.decode(checkNotNull(
            InstrumentationRegistry.getArguments().getString("fixtureBase64")), Base64.DEFAULT), Charsets.UTF_8))
        check(fixture.getString("projectId") == FirebaseEmulatorTestRunner.PROJECT_ID)
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val householdId = fixture.getString("householdId")
        val memberId = fixture.getString("memberId")
        val householdPath = "households/$householdId"
        val householdFields = document(householdPath).getJSONObject("fields")
        val householdName = householdFields.getJSONObject("name").getString("stringValue")
        val originalMembers = householdFields.optJSONObject("members")
        val canonicalPath = "$householdPath/members/$memberId"
        val canonicalBefore = document(canonicalPath)
        val canonicalFields = canonicalBefore.getJSONObject("fields")
        assertTrue(canonicalFields.getJSONObject("aggregateVersion")
            .getString("integerValue").toLong() > 0)
        // New households use the canonical subcollection; reproduce the old embedded projection separately.
        val legacyMembers = JSONObject().put("arrayValue", JSONObject().put("values", JSONArray().put(
            JSONObject().put("mapValue", JSONObject().put("fields", JSONObject()
                .put("id", JSONObject().put("stringValue", memberId))
                .put("name", canonicalFields.getJSONObject("displayName")))))))
        val auth = FirebaseAuth.getInstance()
        try {
            document("$householdPath?updateMask.fieldPaths=members", JSONObject().put("members", legacyMembers))
            HouseholdPreferences.clearHouseholdKey(context)
            assertNull(AndroidSessionMirrorStore(context).load().snapshot)
            withTimeout(30_000) {
                auth.signInWithEmailAndPassword(fixture.getString("email"), fixture.getString("password")).await()
            }
            // No fabricated server maps or direct replaceAuthenticatedSession calls: use the shipped SDK path.
            val resolved = withTimeout(30_000) { NativeMembershipResolver.refresh(context) }
            assertTrue("Real membership resolution must succeed: $resolved", resolved is NativeMembershipResolution.Ready)
            val current = checkNotNull(HouseholdPreferences.snapshot(context))
            assertEquals(householdId, current.householdId)
            assertEquals(memberId, current.memberId)
            assertEquals("Legacy embedded members must not drop the household from the response", householdName, current.householdName)
            assertEquals("A fresh Keystore store must read the saved name", current,
                AndroidSessionMirrorStore(context).load().snapshot)
            assertEquals("Resolution must not rewrite canonical member concurrency metadata",
                canonicalBefore.getString("updateTime"), document(canonicalPath).getString("updateTime"))
            val persistedEntries = document(householdPath).getJSONObject("fields").getJSONObject("members")
                .getJSONObject("arrayValue").getJSONArray("values")
            for (index in 0 until persistedEntries.length()) {
                assertFalse("Read compatibility must not migrate the embedded data",
                    persistedEntries.getJSONObject(index).getJSONObject("mapValue").getJSONObject("fields")
                        .has("aggregateVersion"))
            }
        } finally {
            HouseholdPreferences.clearHouseholdKey(context)
            auth.signOut()
            document("$householdPath?updateMask.fieldPaths=members", JSONObject().apply {
                originalMembers?.let { put("members", it) }
            })
        }
    }

    /** Fixed local demo project only; PATCH replaces just the embedded members fixture. */
    private fun document(path: String, fields: JSONObject? = null): JSONObject {
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val connection = URL("http://10.0.2.2:8080/v1/projects/${FirebaseEmulatorTestRunner.PROJECT_ID}/databases/(default)/documents/$path")
            .openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = if (fields == null) "GET" else "PATCH"
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.setRequestProperty("Authorization", "Bearer owner")
            if (fields != null) {
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.outputStream.use {
                    it.write(JSONObject().put("fields", fields).toString().toByteArray())
                }
            }
            check(connection.responseCode == 200) { "Local Emulator fixture failed: ${connection.responseCode}" }
            JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
}
