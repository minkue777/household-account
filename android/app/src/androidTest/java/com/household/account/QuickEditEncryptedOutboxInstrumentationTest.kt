package com.household.account

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.ledger.HouseholdCommandClient
import com.household.account.ledger.HouseholdCommandResult
import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.quickedit.AndroidKeystoreQuickEditCommandOutboxStore
import com.household.account.quickedit.QuickEditCommandOutbox
import com.household.account.quickedit.QuickEditCommandDeliveryState
import com.household.account.security.AndroidKeystoreEncryptedStore
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore

@RunWith(AndroidJUnit4::class)
class QuickEditEncryptedOutboxInstrumentationTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val preferences get() = context.getSharedPreferences("quick_edit_command_outbox.v1", Context.MODE_PRIVATE)
    private val keyAlias = "household.quickedit.command.outbox.aes256gcm.v1"
    private val scope = CaptureSessionScope("encrypted-house", "member", 1)
    private fun envelope() = HouseholdCommandEnvelopeV1.create(scope.householdId, HouseholdCommandKind.SPLIT,
        mapOf("transactionId" to "transaction", "expectedVersion" to 3, "operation" to mapOf("kind" to "items", "baseDraft" to mapOf("memo" to "private-draft-sentinel"))), "encrypted-test")

    @After fun cleanUp() { AndroidKeystoreQuickEditCommandOutboxStore(context).clear() }

    @Test fun actualKeystoreRetainsConflictUntilNotificationAcknowledgmentAcrossReload() = runBlocking {
        val store = AndroidKeystoreQuickEditCommandOutboxStore(context).also { it.clear() }
        val outbox = QuickEditCommandOutbox(store) { 100L }
        assertTrue(outbox.enqueue(scope, "transaction", envelope()))
        assertFalse(preferences.all.toString().contains("private-draft-sentinel"))
        var calls = 0
        val client = object : HouseholdCommandClient {
            override suspend fun execute(envelope: HouseholdCommandEnvelopeV1): HouseholdCommandResult {
                calls += 1
                return HouseholdCommandResult.Conflict(4)
            }
        }
        assertTrue(outbox.flush(scope, client).requiresWorkerRetry)
        val reloaded = QuickEditCommandOutbox(AndroidKeystoreQuickEditCommandOutboxStore(context)) { 200L }
        assertEquals(QuickEditCommandDeliveryState.NEEDS_ATTENTION, reloaded.snapshot().single().deliveryState)
        assertEquals(envelope(), reloaded.snapshot().single().envelope)
        assertTrue(reloaded.flush(scope, client).requiresWorkerRetry)
        assertEquals(1, calls)
        reloaded.markFailureNotificationDelivered(envelope().commandId)
        assertTrue(AndroidKeystoreQuickEditCommandOutboxStore(context).load().isEmpty())
        assertFalse(preferences.contains("ciphertext"))
    }

    @Test fun ciphertextKeyAndCodecCorruptionFailClosedWithNonSensitivePendingDiagnostic() = runBlocking {
        for (damage in listOf("ciphertext", "key", "codec")) {
            val store = AndroidKeystoreQuickEditCommandOutboxStore(context).also { it.clear() }
            QuickEditCommandOutbox(store).enqueue(scope, "transaction", envelope())
            when (damage) {
                "ciphertext" -> check(preferences.edit().putString("ciphertext", "invalid-ciphertext").commit())
                "key" -> KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(keyAlias) }
                "codec" -> AndroidKeystoreEncryptedStore(context, "quick_edit_command_outbox.v1", keyAlias).write("not-json")
            }
            val reloaded = AndroidKeystoreQuickEditCommandOutboxStore(context)
            assertTrue(damage, reloaded.load().isEmpty())
            assertFalse(damage, preferences.contains("ciphertext"))
            assertTrue(damage, reloaded.hasUnrecoverableLossNotificationPending())
            val diagnostics = context.getSharedPreferences("quick_edit_command_outbox.diagnostics.v1", Context.MODE_PRIVATE)
            assertEquals(mapOf("unrecoverableLossPending" to true), diagnostics.all)
            reloaded.acknowledgeUnrecoverableLossNotification()
            assertFalse(reloaded.hasUnrecoverableLossNotificationPending())
        }
    }

    @Test fun actualEncryptedReloadRetriesUntilExactly72HoursThenRetainsOnlyForFailureNotification() = runBlocking {
        val store = AndroidKeystoreQuickEditCommandOutboxStore(context).also { it.clear() }
        QuickEditCommandOutbox(store) { 100L }.enqueue(scope, "transaction", envelope())
        var now = 100L + QuickEditCommandOutbox.MAX_RETRY_WINDOW_MILLIS - 1
        var calls = 0
        val client = object : HouseholdCommandClient {
            override suspend fun execute(envelope: HouseholdCommandEnvelopeV1): HouseholdCommandResult {
                calls += 1
                return HouseholdCommandResult.RetryableFailure("UNAVAILABLE")
            }
        }
        val reloaded = QuickEditCommandOutbox(AndroidKeystoreQuickEditCommandOutboxStore(context)) { now }
        assertEquals(1, reloaded.flush(scope, client).pendingCount)
        now += 1
        val terminal = reloaded.flush(scope, client)
        assertEquals(1, calls)
        assertEquals(0, terminal.pendingCount)
        assertTrue(terminal.requiresWorkerRetry)
        assertEquals("QUICK_EDIT_RETRY_WINDOW_EXPIRED", reloaded.snapshot().single().terminalCode)
        reloaded.markFailureNotificationDelivered(envelope().commandId)
        assertTrue(store.load().isEmpty())
    }
}
