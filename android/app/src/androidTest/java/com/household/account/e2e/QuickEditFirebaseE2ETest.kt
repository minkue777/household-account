package com.household.account.e2e

import android.content.Context
import android.content.ContextWrapper
import android.content.ComponentName
import android.content.Intent
import android.app.Notification
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.service.notification.StatusBarNotification
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
import android.widget.TextView
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.ViewAction
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.closeSoftKeyboard
import androidx.test.espresso.action.ViewActions.replaceText
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.flexbox.FlexboxLayout
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.household.account.QuickEditActivity
import com.household.account.R
import com.household.account.ledger.CallableLedgerTransactionQueryClient
import com.household.account.ledger.LedgerTransactionQueryResult
import com.household.account.ledger.LedgerTransactionSnapshot
import com.household.account.paymentcapture.AndroidKeystoreCaptureQueueStore
import com.household.account.paymentcapture.CaptureDeliveryFollowUp
import com.household.account.paymentcapture.RawNotificationEnvelopeV1
import com.household.account.quickedit.AndroidKeystoreQuickEditCommandOutboxStore
import com.household.account.quickedit.AndroidKeystoreQuickEditQueueStore
import com.household.account.quickedit.QuickEditCoordinator
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.service.CardNotificationListenerService
import com.household.account.util.HouseholdPreferences
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** 실제 서버 생성 카테고리/규칙 → 수집 callable → Native Quick Edit → 저장 callable 전체 연결입니다. */
@FirebaseEmulatorE2E
@RunWith(AndroidJUnit4::class)
class QuickEditFirebaseE2ETest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context get() = instrumentation.targetContext

    @Test
    fun serverCreatedCategoryFlowsThroughCaptureIntoQuickEditAndMemoSave() = runBlocking {
        val resultFile = File(context.filesDir, "native-firebase-e2e-result.json")
        check(!resultFile.exists() || resultFile.delete())
        val encoded = checkNotNull(InstrumentationRegistry.getArguments().getString("fixtureBase64")) {
            "fixtureBase64 is required; run the Firebase Emulator E2E preparation command"
        }
        val fixture = JSONObject(String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8))
        check(fixture.getString("projectId") == FirebaseEmulatorTestRunner.PROJECT_ID)
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val householdId = fixture.getString("householdId")
        val memberId = fixture.getString("memberId")
        val categoryId = fixture.getString("categoryId")
        val categoryName = fixture.getString("categoryName")
        check(categoryId.any(Char::isUpperCase) && categoryId.any(Char::isLowerCase)) {
            "The server-generated category ID must exercise mixed-case identity preservation"
        }
        val raw = RawNotificationEnvelopeV1.fromJson(fixture.getJSONObject("rawNotification").toString())
        val auth = FirebaseAuth.getInstance()
        val monitor = instrumentation.addMonitor(QuickEditActivity::class.java.name, null, false)
        var activity: QuickEditActivity? = null
        val previousOverlayPermission = Settings.canDrawOverlays(context)
        fun awaitNextActivity(previous: QuickEditActivity?, timeoutMillis: Long): QuickEditActivity? {
            val deadline = SystemClock.elapsedRealtime() + timeoutMillis
            while (true) {
                val remaining = deadline - SystemClock.elapsedRealtime()
                if (remaining <= 0) return null
                val next = monitor.waitForActivityWithTimeout(remaining) as? QuickEditActivity ?: return null
                // Android reports both creation and resume to the monitor. A second lifecycle
                // callback for the current instance is not the next FIFO Activity.
                if (next !== previous) return next
            }
        }

        try {
            auth.signOut()
            withTimeout(30_000) {
                auth.signInWithEmailAndPassword(fixture.getString("email"), fixture.getString("password")).await()
                HouseholdPreferences.replaceAuthenticatedSession(context, householdId, memberId, "Native E2E")
            }
            HouseholdPreferences.setQuickEditOverlayEnabled(context, householdId, memberId, true)
            shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW allow")
            eventually("Quick Edit overlay permission") { Settings.canDrawOverlays(context) }
            // Test account bootstrap is outside the production capture/edit flow being observed.
            shell("logcat -c")

            // Replace only Android's external notification delivery. The actual service extracts,
            // deduplicates, queues and submits it, including the real authenticated SDK connection.
            val listener = CardNotificationListenerService()
            ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java).apply {
                isAccessible = true
            }.invoke(listener, context)
            val notification = Notification.Builder(context, "e2e-card-input").build().apply {
                extras.putCharSequence(Notification.EXTRA_TITLE, raw.notification.title)
                extras.putCharSequence(Notification.EXTRA_TEXT, raw.notification.text)
                extras.putCharSequence(Notification.EXTRA_BIG_TEXT, raw.notification.bigText)
                extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES, raw.notification.textLines.toTypedArray())
            }
            @Suppress("DEPRECATION")
            val externalInput = StatusBarNotification(raw.packageName, raw.packageName, 7, "e2e-card", Process.myUid(),
                Process.myPid(), 0, notification, Process.myUserHandle(), Instant.parse(raw.notification.postedAt).toEpochMilli())
            listener.onNotificationPosted(externalInput)
            listener.onNotificationPosted(externalInput)
            // Instrumentation.waitForMonitorWithTimeout removes the monitor after its first hit.
            // Keep this monitor registered to observe all three real FIFO Activity launches.
            activity = awaitNextActivity(null, 30_000)
            assertNotNull("Production listener and QuickEditCoordinator must launch the Activity", activity)
            val opened = checkNotNull(activity)
            val actualQueue = AndroidKeystoreQuickEditQueueStore(context).load()
            val head = actualQueue.entries.single()
            val snapshot = checkNotNull(head.snapshot) { "Actual server receipt must contain the Quick Edit snapshot" }
            val followUp = CaptureDeliveryFollowUp(checkNotNull(head.observationId), head.transactionId, snapshot.aggregateVersion, snapshot)
            assertEquals(head.transactionId, actualQueue.activeTransactionId)
            assertEquals(head.transactionId, opened.intent.getStringExtra(QuickEditActivity.EXTRA_EXPENSE_ID))
            assertEquals(categoryId, snapshot.categoryId)
            assertEquals(fixture.getString("expectedMerchant"), snapshot.merchant)
            assertEquals(fixture.getInt("expectedAmountInWon"), snapshot.amountInWon)
            assertTrue(AndroidKeystoreCaptureQueueStore(context).load().isEmpty())

            assertEquals("Duplicate OS callbacks must commit only one capture receipt", 1, captureLedgerReceiptCount(householdId))
            eventually("Actual CategoryRepository result and exact selected category") {
                var ready = false
                instrumentation.runOnMainSync {
                    val categories = opened.findViewById<FlexboxLayout>(R.id.categoryContainer)
                    val selected = (0 until categories.childCount)
                        .map(categories::getChildAt).filter(View::isSelected)
                    ready = selected.size == 1 &&
                        selected.single().texts().contains(categoryName.substringBefore('/'))
                }
                ready
            }
            instrumentation.runOnMainSync {
                assertEquals(snapshot.merchant, opened.findViewById<EditText>(R.id.etMerchant).text.toString())
                assertEquals(snapshot.amountInWon.toString(), opened.findViewById<EditText>(R.id.etAmount).text.toString())
                assertEquals(0, opened.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE)
                @Suppress("DEPRECATION")
                val dismissKeyguard = WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                assertEquals(0, opened.window.attributes.flags and dismissKeyguard)
                assertTrue(opened.intent.flags and Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS != 0)
            }
            @Suppress("DEPRECATION")
            val installedActivity = context.packageManager.getActivityInfo(ComponentName(context, QuickEditActivity::class.java), 0)
            assertFalse("External apps must not start Quick Edit directly", installedActivity.exported)

            // Two more real captures arrive while A remains open. Their actual committed snapshots
            // must wait in the encrypted FIFO rather than replacing the current Activity.
            fun additionalInput(amount: String, id: Int): StatusBarNotification {
                val copy = notification.clone().apply {
                    extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES,
                        raw.notification.textLines.mapIndexed { index, line -> if (index == 0) "${amount}원 일시불" else line }.toTypedArray())
                }
                @Suppress("DEPRECATION")
                return StatusBarNotification(raw.packageName, raw.packageName, id, "e2e-card-$id", Process.myUid(),
                    Process.myPid(), 0, copy, Process.myUserHandle(), Instant.parse(raw.notification.postedAt).toEpochMilli())
            }
            listener.onNotificationPosted(additionalInput("22,300", 8))
            eventually("Second real capture enters FIFO behind A", 60_000) { AndroidKeystoreQuickEditQueueStore(context).load().entries.size == 2 }
            listener.onNotificationPosted(additionalInput("32,300", 9))
            eventually("Third real capture enters FIFO behind B", 60_000) { AndroidKeystoreQuickEditQueueStore(context).load().entries.size == 3 }
            val queued = AndroidKeystoreQuickEditQueueStore(context).load()
            assertEquals(head.transactionId, queued.activeTransactionId)
            assertEquals(listOf(12300, 22300, 32300), queued.entries.map { it.snapshot?.amountInWon })
            assertEquals(1, monitor.hits)
            assertFalse(opened.isFinishing)

            // Espresso logs the action description in the target app process. Keep its real
            // text-entry implementation but do not make the test driver leak the private input.
            val enterMemo = object : ViewAction by replaceText(SAVED_MEMO) {
                override fun getDescription() = "enter private memo text"
            }
            onView(withId(R.id.etMemo)).perform(enterMemo, closeSoftKeyboard())
            onView(withId(R.id.btnSave)).perform(click())
            eventually("Quick Edit durable acceptance closes the screen") { opened.isFinishing || opened.isDestroyed }

            for (queuedEntry in queued.entries.drop(1)) {
                val next = awaitNextActivity(activity, 15_000)
                assertNotNull("Durable acceptance or explicit close must advance exactly one FIFO entry", next)
                activity = next
                assertEquals(queuedEntry.transactionId, next!!.intent.getStringExtra(QuickEditActivity.EXTRA_EXPENSE_ID))
                assertEquals(queuedEntry.snapshot!!.amountInWon, next.intent.getIntExtra(QuickEditActivity.EXTRA_AMOUNT, 0))
                eventually("Next FIFO entry becomes current") { AndroidKeystoreQuickEditQueueStore(context).load().activeTransactionId == queuedEntry.transactionId }
                onView(withId(R.id.btnClose)).perform(click())
                eventually("Explicit close advances FIFO") { next.isFinishing || next.isDestroyed }
            }
            eventually("All FIFO entries are consumed") { AndroidKeystoreQuickEditQueueStore(context).load().entries.isEmpty() }
            assertEquals(3, monitor.hits)

            val query = CallableLedgerTransactionQueryClient(FirebaseAuthenticatedCallableGateway())
            var persisted: LedgerTransactionSnapshot? = null
            eventually("Native outbox commits the update through the actual authenticated callable", 60_000) {
                val result = query.get(householdId, followUp.transactionId)
                persisted = (result as? LedgerTransactionQueryResult.Success)?.value
                persisted?.memo == SAVED_MEMO
            }
            val saved = checkNotNull(persisted)
            assertEquals(categoryId, saved.categoryId)
            assertEquals(snapshot.merchant, saved.merchant)
            assertEquals(snapshot.amountInWon, saved.amountInWon)
            assertEquals(snapshot.aggregateVersion + 1, saved.aggregateVersion)
            eventually("Successful delivery removes the encrypted outbox entry") {
                AndroidKeystoreQuickEditCommandOutboxStore(context).load().isEmpty()
            }
            assertFalse(context.getSharedPreferences("quick_edit_command_outbox.v1", Context.MODE_PRIVATE)
                .all.toString().contains(SAVED_MEMO))
            assertEquals("Only three distinct notifications create capture receipts", 3, captureLedgerReceiptCount(householdId))

            // Use the real receipt again so removing either gate would enqueue and reopen this transaction.
            val queueStore = AndroidKeystoreQuickEditQueueStore(context)
            val queueBefore = queueStore.load()
            val launchesBefore = monitor.hits
            HouseholdPreferences.setQuickEditOverlayEnabled(context, householdId, memberId, false)
            QuickEditCoordinator.enqueueAndPresent(context, HouseholdPreferences.currentScope(context), followUp)
            assertEquals("Disabled Quick Edit must not modify its durable queue", queueBefore, queueStore.load())
            assertEquals(launchesBefore, monitor.hits)
            HouseholdPreferences.setQuickEditOverlayEnabled(context, householdId, memberId, true)
            shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW deny")
            eventually("Overlay permission revoked") { !Settings.canDrawOverlays(context) }
            QuickEditCoordinator.enqueueAndPresent(context, HouseholdPreferences.currentScope(context), followUp)
            assertEquals("Missing overlay permission must not modify the durable queue", queueBefore, queueStore.load())
            assertEquals(launchesBefore, monitor.hits)

            val appLog = shell("logcat -d --pid=${Process.myPid()} -v brief")
            val authToken = withTimeout(10_000) { auth.currentUser!!.getIdToken(false).await().token }
            val privateValues = listOf(
                "household" to householdId, "member" to memberId, "email" to fixture.getString("email"),
                "merchant" to snapshot.merchant, "memo" to SAVED_MEMO,
                "raw title" to raw.notification.title, "raw text" to raw.notification.text, "credential" to authToken
            ) + raw.notification.textLines.mapIndexed { index, line -> "raw line $index" to line }
            privateValues.forEach { (field, sensitive) ->
                if (!sensitive.isNullOrBlank()) {
                    assertFalse("Application log must not expose private $field", appLog.contains(sensitive))
                }
            }

            resultFile.writeText(JSONObject()
                .put("householdId", householdId).put("memberId", memberId)
                .put("transactionId", saved.transactionId).put("categoryId", saved.categoryId)
                .put("categoryName", categoryName).put("merchant", saved.merchant)
                .put("amountInWon", saved.amountInWon).put("memo", saved.memo)
                .put("aggregateVersion", saved.aggregateVersion).toString(), Charsets.UTF_8)
        } finally {
            instrumentation.removeMonitor(monitor)
            activity?.let { opened -> instrumentation.runOnMainSync { if (!opened.isFinishing) opened.finish() } }
            HouseholdPreferences.clearHouseholdKey(context)
            auth.signOut()
            if (!previousOverlayPermission) shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW deny")
        }
    }

    private suspend fun eventually(description: String, timeoutMillis: Long = 15_000, check: suspend () -> Boolean) {
        try {
            withTimeout(timeoutMillis) {
                while (!check()) delay(100)
            }
        } catch (error: TimeoutCancellationException) {
            throw AssertionError("$description did not complete within ${timeoutMillis}ms", error)
        }
    }

    private fun shell(command: String): String =
        instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            FileInputStream(descriptor.fileDescriptor).use { it.readBytes().toString(Charsets.UTF_8) }
        }

    /** Test observation only; fixed local demo REST endpoint prevents production access. */
    private fun captureLedgerReceiptCount(householdId: String): Int {
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        // Approval-only capture intentionally commits its receipt with Ledger and omits the root receipt.
        val connection = URL("http://10.0.2.2:8080/v1/projects/${FirebaseEmulatorTestRunner.PROJECT_ID}/databases/(default)/documents/commandReceipts/payment-capture-ledger/receipts?pageSize=1000")
            .openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.setRequestProperty("Authorization", "Bearer owner")
            check(connection.responseCode == 200) { "Local Emulator receipt observation failed" }
            val documents = JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).optJSONArray("documents") ?: return 0
            return (0 until documents.length()).count { index ->
                documents.getJSONObject(index).getJSONObject("fields").getJSONObject("householdId").getString("stringValue") == householdId
            }
        } finally { connection.disconnect() }
    }

    private fun View.texts(): List<String> = buildList {
        if (this@texts is TextView) add(text.toString())
        if (this@texts is ViewGroup) for (index in 0 until childCount) addAll(getChildAt(index).texts())
    }

    companion object { private const val SAVED_MEMO = "Android E2E 메모" }
}
