package com.household.account.e2e

import android.Manifest
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.webkit.WebView
import android.widget.EditText
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.household.account.MainActivity
import com.household.account.QuickEditActivity
import com.household.account.R
import com.household.account.ledger.CallableLedgerTransactionQueryClient
import com.household.account.ledger.LedgerTransactionQueryResult
import com.household.account.ledger.LedgerTransactionSnapshot
import com.household.account.paymentcapture.CaptureDeliveryFollowUp
import com.household.account.quickedit.AndroidKeystoreQuickEditCommandOutboxStore
import com.household.account.quickedit.QuickEditCommandDelivery
import com.household.account.quickedit.QuickEditCoordinator
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.util.HouseholdPreferences
import com.household.account.webhost.TrustedWebOrigin
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlin.coroutines.resume
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real QuickEdit Activity → durable outbox → origin-bound bridge → served Web ledger list.
 * The gate delays transport only. SDK authentication, command results and conflicts stay real.
 */
@FirebaseEmulatorE2E
@RunWith(AndroidJUnit4::class)
class QuickEditWebFeedbackFirebaseE2ETest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext

    @Test fun acceptedUpdateAppearsBeforeServerRequestAndConflictRestoresCanonicalList() = runBlocking {
        val arguments = InstrumentationRegistry.getArguments()
        val origin = checkNotNull(arguments.getString("webOrigin"))
        check(origin == "https://localhost:3443" && TrustedWebOrigin.APP_ORIGIN == origin)
        check(arguments.getString("quickEditCommandGatePort") == "5002")
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val fixture = JSONObject(String(android.util.Base64.decode(checkNotNull(arguments.getString("fixtureBase64")), android.util.Base64.DEFAULT), Charsets.UTF_8))
        val householdId = fixture.getString("householdId")
        val memberId = fixture.getString("memberId")
        val auth = FirebaseAuth.getInstance()
        val query = CallableLedgerTransactionQueryClient(FirebaseAuthenticatedCallableGateway())
        val resultFile = File(context.filesDir, "native-quickedit-feedback-e2e-result.json")
        check(!resultFile.exists() || resultFile.delete())
        val oldOverlay = Settings.canDrawOverlays(context)
        val oldListeners = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        val monitor = instrumentation.addMonitor(QuickEditActivity::class.java.name, null, false)
        var scenario: ActivityScenario<MainActivity>? = null
        var opened: QuickEditActivity? = null
        try {
            withTimeout(30_000) { auth.signInWithEmailAndPassword(fixture.getString("email"), fixture.getString("password")).await() }
            HouseholdPreferences.replaceAuthenticatedSession(context, householdId, memberId, "QuickEdit Web E2E")
            HouseholdPreferences.setQuickEditOverlayEnabled(context, householdId, memberId, true)
            val date = LocalDate.now(ZoneId.of("Asia/Seoul")).toString()
            val created = directCommand(auth, householdId, "ledger.record-manual-transaction.v1", JSONObject()
                .put("transactionType", "expense").put("amountInWon", 13579).put("accountingDate", date)
                .put("merchant", MERCHANT).put("categoryId", fixture.getString("categoryId")).put("memo", ORIGINAL))
            val transactionId = created.getString("transactionId")
            suspend fun current(): LedgerTransactionSnapshot = checkNotNull(
                (query.get(householdId, transactionId) as? LedgerTransactionQueryResult.Success)?.value)

            shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW deny")
            eventually("Permission guide before real Web navigation") { !Settings.canDrawOverlays(context) }
            scenario = ActivityScenario.launch(MainActivity::class.java)
            lateinit var webView: WebView
            scenario.onActivity { webView = it.findViewById(R.id.webView) }
            suspend fun evaluate(script: String): Any? = suspendCancellableCoroutine { continuation ->
                instrumentation.runOnMainSync {
                    webView.evaluateJavascript(script) { value -> if (continuation.isActive) continuation.resume(JSONTokener(value).nextValue()) }
                }
            }
            suspend fun rowText(): String = evaluate("[...document.querySelectorAll('[data-testid=\"expense-item\"]')].find(e=>e.innerText.includes(${JSONObject.quote(MERCHANT)}))?.innerText || ''").toString()
            shell("settings put secure enabled_notification_listeners ${context.packageName}/com.household.account.service.CardNotificationListenerService")
            shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW allow")
            if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
            eventually("Required permissions applied") { Settings.canDrawOverlays(context) }
            scenario.onActivity { it.findViewById<android.view.View>(R.id.btnCheckPermission).performClick() }
            eventually("Actual Web login or authenticated home") {
                evaluate("Boolean(document.querySelector('.calendar-glass') || [...document.querySelectorAll('button')].some(b=>b.textContent.includes('테스트 계정으로 로그인')))") == true
            }
            evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('테스트 계정으로 로그인'))?.click();true")
            eventually("Actual SDK home source is ready") { evaluate("Boolean(document.querySelector('.calendar-glass[aria-busy=\"false\"]'))") == true }
            evaluate("document.querySelector('[data-testid=\"calendar-day-$date\"]')?.click();true")
            eventually("Original server memo in the actual expense list") { rowText().contains(ORIGINAL) }
            // Observe actual responses without replacing, fabricating or suppressing a response.
            assertEquals(true, evaluate("""
                (() => {
                  const bridge = window.HouseholdNativeBridge;
                  const receive = bridge?.onmessage;
                  if (typeof receive !== 'function') return false;
                  window.quickEditFeedbackStates = [];
                  bridge.onmessage = function(event) {
                    try {
                      const value = JSON.parse(event.data).result?.value;
                      if (value?.contractVersion === 'quick-edit-update-feedback.v1') {
                        for (const update of value.updates) window.quickEditFeedbackStates.push({
                          state: update.state, memo: update.patch.memo,
                          canonicalMemo: update.transaction?.memo, version: update.transaction?.aggregateVersion
                        });
                      }
                    } finally { receive.call(this, event); }
                  };
                  return true;
                })()
            """.trimIndent()))

            suspend fun saveDraft(snapshot: LedgerTransactionSnapshot, memo: String, tag: String): QuickEditActivity {
                gate("arm", JSONObject().put("transactionId", transactionId))
                val previous = opened
                QuickEditCoordinator.enqueueAndPresent(context, HouseholdPreferences.currentScope(context),
                    CaptureDeliveryFollowUp("feedback-${UUID.randomUUID()}", transactionId, snapshot.aggregateVersion))
                val deadline = SystemClock.elapsedRealtime() + 30_000
                var activity: QuickEditActivity? = null
                while (activity == null && SystemClock.elapsedRealtime() < deadline) {
                    val next = monitor.waitForActivityWithTimeout(deadline - SystemClock.elapsedRealtime()) as? QuickEditActivity
                    if (next !== previous) activity = next
                }
                val edit = checkNotNull(activity) { "Actual QuickEditCoordinator must open the editing Activity" }
                opened = edit
                eventually("Actual query fallback loads the original memo") {
                    var ready = false
                    instrumentation.runOnMainSync { ready = edit.findViewById<EditText>(R.id.etMemo).text.toString() == snapshot.memo }
                    ready
                }
                instrumentation.runOnMainSync {
                    edit.findViewById<EditText>(R.id.etMemo).setText(memo)
                    edit.findViewById<EditText>(R.id.etTags).setText(tag)
                    edit.findViewById<android.view.View>(R.id.btnSave).performClick()
                }
                eventually("Actual SDK update is held before forwarding", 15_000) { gate("status").getBoolean("waiting") }
                eventually("QuickEdit closes on durable local acceptance", 15_000) { edit.isFinishing || edit.isDestroyed }
                return edit
            }

            val original = current()
            saveDraft(original, SAVED, SAVED_TAG)
            eventually("Pending memo and tags appear in the real Web list before server forwarding", 15_000) {
                rowText().let { it.contains(SAVED) && it.contains(SAVED_TAG) && !it.contains(ORIGINAL) }
            }
            assertEquals(0, gate("status").getInt("forwarded"))
            assertEquals("The actual server remains unchanged while the list already shows the draft", original, current())
            gate("release", JSONObject())
            eventually("Actual server command succeeds") { current().let { it.memo == SAVED && it.aggregateVersion == original.aggregateVersion + 1 && it.tags.contains(SAVED_TAG) } }
            eventually("Successful receipt is committed to Web and acknowledged") {
                rowText().contains(SAVED) && AndroidKeystoreQuickEditCommandOutboxStore(context).load().isEmpty() &&
                    QuickEditCommandDelivery.updateFeedback(context, HouseholdPreferences.currentScope(context)).isEmpty() &&
                    evaluate("window.quickEditFeedbackStates.some(x=>x.state==='succeeded' && x.canonicalMemo===${JSONObject.quote(SAVED)} && x.version===${original.aggregateVersion + 1})") == true
            }

            val beforeConflict = current()
            saveDraft(beforeConflict, CONFLICT_DRAFT, CONFLICT_TAG)
            eventually("Second pending draft appears before its actual request is forwarded", 15_000) { rowText().contains(CONFLICT_DRAFT) }
            assertEquals(0, gate("status").getInt("forwarded"))
            assertEquals(beforeConflict, current())
            // A second authenticated client wins a real version race. No mocked conflict response.
            val canonical = directCommand(auth, householdId, "ledger.update-transaction.v1", JSONObject()
                .put("transactionId", transactionId).put("expectedVersion", beforeConflict.aggregateVersion)
                .put("patch", JSONObject().put("memo", WINNER)))
            assertEquals(beforeConflict.aggregateVersion + 1, canonical.getInt("aggregateVersion"))
            gate("release", JSONObject())
            eventually("Actual version conflict rolls back the Web overlay and acknowledges terminal feedback") {
                val text = rowText()
                gate("status").getBoolean("completed") && text.contains(WINNER) && !text.contains(CONFLICT_DRAFT) && !text.contains(CONFLICT_TAG) &&
                    AndroidKeystoreQuickEditCommandOutboxStore(context).load().isEmpty() &&
                    QuickEditCommandDelivery.updateFeedback(context, HouseholdPreferences.currentScope(context)).isEmpty() &&
                    evaluate("window.quickEditFeedbackStates.some(x=>x.state==='failed' && x.memo===${JSONObject.quote(CONFLICT_DRAFT)})") == true
            }
            assertEquals(WINNER, current().memo)
            assertEquals(beforeConflict.aggregateVersion + 1, current().aggregateVersion)
            assertEquals(beforeConflict.tags, current().tags)
            resultFile.writeText(JSONObject().put("contractVersion", "quick-edit-web-feedback-e2e.v1")
                .put("pendingBeforeForward", true).put("successCanonical", true).put("conflictRollback", true).toString())
        } finally {
            runCatching { if (gate("status").optBoolean("waiting")) gate("release", JSONObject()) }
            instrumentation.removeMonitor(monitor)
            opened?.let { edit -> instrumentation.runOnMainSync { if (!edit.isFinishing) edit.finish() } }
            scenario?.close()
            HouseholdPreferences.clearHouseholdKey(context)
            auth.signOut()
            if (!oldOverlay) shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW deny")
            if (oldListeners.isNullOrBlank()) shell("settings delete secure enabled_notification_listeners")
            else shell("settings put secure enabled_notification_listeners $oldListeners")
        }
    }

    private suspend fun directCommand(auth: FirebaseAuth, householdId: String, command: String, payload: JSONObject): JSONObject {
        val token = checkNotNull(auth.currentUser!!.getIdToken(false).await().token)
        val commandId = "feedback-e2e-${UUID.randomUUID()}"
        val result = request("http://10.0.2.2:5001/${FirebaseEmulatorTestRunner.PROJECT_ID}/asia-northeast3/executeHouseholdCommand",
            JSONObject().put("data", JSONObject().put("contractVersion", "household-command.v1")
                .put("commandId", commandId).put("idempotencyKey", commandId).put("householdId", householdId)
                .put("command", command).put("payload", payload)), token).getJSONObject("result").getJSONObject("result")
        assertEquals("Fixture command must be accepted by the actual server", "succeeded", result.getString("kind"))
        return result.getJSONObject("value")
    }

    private fun gate(operation: String, payload: JSONObject? = null) = request("http://10.0.2.2:5002/__quickedit_gate/$operation", payload)

    private fun request(url: String, payload: JSONObject?, token: String? = null): JSONObject {
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 5_000
            connection.readTimeout = 15_000
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (payload != null) {
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.outputStream.use { it.write(payload.toString().toByteArray()) }
            }
            check(connection.responseCode == 200) { "Local E2E transport returned ${connection.responseCode}" }
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }

    private suspend fun eventually(description: String, timeoutMillis: Long = 60_000, check: suspend () -> Boolean) {
        try { withTimeout(timeoutMillis) { while (!check()) delay(100) } }
        catch (error: kotlinx.coroutines.TimeoutCancellationException) { throw AssertionError(description, error) }
    }

    private fun shell(command: String) = instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
        FileInputStream(descriptor.fileDescriptor).use { it.readBytes().toString(Charsets.UTF_8) }
    }

    companion object {
        private const val MERCHANT = "Native Web 즉시반영 검사"
        private const val ORIGINAL = "기존 원장 메모"
        private const val SAVED = "접수 즉시 보이는 메모"
        private const val SAVED_TAG = "즉시반영성공"
        private const val CONFLICT_DRAFT = "충돌하면 없어질 메모"
        private const val CONFLICT_TAG = "충돌임시태그"
        private const val WINNER = "서버에서 먼저 저장한 메모"
    }
}
