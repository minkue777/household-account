package com.household.account.e2e

import android.Manifest
import android.app.Application
import android.app.Notification
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.service.notification.StatusBarNotification
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.flexbox.FlexboxLayout
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.household.account.MainActivity
import com.household.account.QuickEditActivity
import com.household.account.R
import com.household.account.ledger.CallableLedgerTransactionQueryClient
import com.household.account.ledger.LedgerTransactionQueryResult
import com.household.account.paymentcapture.RawNotificationEnvelopeV1
import com.household.account.quickedit.AndroidKeystoreQuickEditCommandOutboxStore
import com.household.account.quickedit.AndroidKeystoreQuickEditQueueStore
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.service.CardNotificationListenerService
import com.household.account.util.HouseholdPreferences
import com.household.account.webhost.TrustedWebOrigin
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Normal Firebase correctness E2E excludes this opt-in, repeated measurement class. */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class FirebasePerformanceE2E

@FirebaseEmulatorE2E
@FirebasePerformanceE2E
@RunWith(AndroidJUnit4::class)
class NativePerformanceFirebaseE2ETest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context get() = instrumentation.targetContext
    private val samples = JSONArray()

    @Test fun authenticatedActivityStartupAndRealNotificationQuickEditRepeated() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        val repetitions = (args.getString("performanceSamples") ?: "7").toInt().also { require(it in 1..30) }
        val isolateWebView = args.getString("performanceIsolateWebView") == "true"
        val homeMetric = if (isolateWebView) "android.home.isolated-activity-complete" else "android.home.activity-reopen-complete"
        check(args.getString("webOrigin") == "https://localhost:3443")
        check(TrustedWebOrigin.APP_ORIGIN == "https://localhost:3443")
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val fixture = JSONObject(String(android.util.Base64.decode(checkNotNull(args.getString("fixtureBase64")), android.util.Base64.DEFAULT), Charsets.UTF_8))
        check(fixture.getString("projectId") == FirebaseEmulatorTestRunner.PROJECT_ID)
        val householdId = fixture.getString("householdId")
        val memberId = fixture.getString("memberId")
        val auth = FirebaseAuth.getInstance()
        val oldOverlay = Settings.canDrawOverlays(context)
        val oldListeners = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        val resultFile = File(context.filesDir, "native-performance-result.json")
        check(!resultFile.exists() || resultFile.delete())
        try {
            withTimeout(30_000) { auth.signInWithEmailAndPassword(fixture.getString("email"), fixture.getString("password")).await() }
            HouseholdPreferences.replaceAuthenticatedSession(context, householdId, memberId, "Performance fixture")
            HouseholdPreferences.setQuickEditOverlayEnabled(context, householdId, memberId, true)
            shell("settings put secure enabled_notification_listeners ${context.packageName}/com.household.account.service.CardNotificationListenerService")
            shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW allow")
            if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
            eventually("Overlay permission") { Settings.canDrawOverlays(context) }
            writeFixture("households/$householdId/homePreferences/home", JSONObject()
                .put("left", JSONObject().put("stringValue", "MONTHLY_EXPENSE"))
                .put("right", JSONObject().put("stringValue", "LOCAL_CURRENCY_BALANCE"))
                .put("selectedLocalCurrencyType", JSONObject().put("stringValue", "gyeonggi"))
                .put("aggregateVersion", JSONObject().put("integerValue", "1")))
            writeFixture("households/$householdId/localCurrencyBalances/gyeonggi", JSONObject()
                .put("localCurrencyType", JSONObject().put("stringValue", "gyeonggi"))
                .put("balanceInWon", JSONObject().put("integerValue", "25789")))

            // Bootstrap real Web Firebase Auth outside measurement; no response, clock or bridge mocks.
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var web: WebView
                scenario.onActivity { web = it.findViewById(R.id.webView) }
                eventually("Real login or home") {
                    evaluate(web, "Boolean(document.querySelector('.calendar-glass') || [...document.querySelectorAll('button')].some(b=>b.textContent.includes('테스트 계정으로 로그인')))") == true
                }
                evaluate(web, "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('테스트 계정으로 로그인'))?.click();true")
                eventually("Authenticated home with fixture balance") { homeReady(web, fixture.getInt("expectedMonthlyExpenseInWon")) }
                if (isolateWebView) disposeMeasuredDocument(web)
            }

            repeat(repetitions) { index ->
                ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                    lateinit var web: WebView
                    var startedAt = 0L
                    scenario.onActivity { activity ->
                        web = activity.findViewById(R.id.webView)
                        val clock = MainActivity::class.java.getDeclaredField("appLaunchDurationClock").apply { isAccessible = true }.get(activity)
                        startedAt = clock.javaClass.getDeclaredField("startedAtMillis").apply { isAccessible = true }.getLong(clock)
                    }
                    eventually("Fresh Activity home complete paint") { homeReady(web, fixture.getInt("expectedMonthlyExpenseInWon")) }
                    // Production mark is taken after all home data. Translate the browser clock to
                    // Android monotonic time in a single callback; polling latency is not the metric.
                    val observed = JSONObject(evaluate(web, "JSON.stringify({now:performance.now(),paint:performance.getEntriesByName('household-account:startup:home:first-complete-paint')[0].startTime})").toString())
                    val completeAt = SystemClock.elapsedRealtime() - (observed.getDouble("now") - observed.getDouble("paint"))
                    sample(homeMetric, index, completeAt - startedAt)
                    if (isolateWebView) disposeMeasuredDocument(web)
                }
            }
            if (!isolateWebView) measureQuickEdit(fixture, repetitions)
            resultFile.writeText(JSONObject().put("schemaVersion", 1).put("suite", "native-firebase-performance")
                .put("repetitions", repetitions).put("recordedAt", Instant.now().toString())
                .put("environment", JSONObject().put("androidApi", Build.VERSION.SDK_INT).put("device", Build.MODEL)
                    .put("webView", WebView.getCurrentWebViewPackage()?.versionName)
                    .put("animatorDurationScale", shell("settings get global animator_duration_scale").trim())
                    .put("windowAnimationScale", shell("settings get global window_animation_scale").trim())
                    .put("transitionAnimationScale", shell("settings get global transition_animation_scale").trim())
                    .put("buildType", "debug").put("firebase", "local-emulators").put("web", "production-next-build")
                    .put("homeMode", if (isolateWebView) "diagnostic-test-disposes-previous-webview" else "production-activity-lifecycle-warm-process-and-http-cache")
                    .put("quickEditMode", "real-onNotificationPosted-os-delivery-excluded-one-recorded-warmup"))
                .put("measurementDefinitions", JSONObject()
                    .put("android.home.activity-reopen-complete", "Actual MainActivity monotonic start to production first-home-complete-paint; auth/permission bootstrap excluded, process not restarted. Production Activity close lifecycle is retained without test cleanup. Clock bridge observation adds small callback overhead.")
                    .put("android.home.isolated-activity-complete", "Diagnostic only: same start/end, but test destroys the previous WebView after measurement. Compare against production Activity lifecycle; never substitute for the default benchmark.")
                    .put("android.quick-edit.notification-to-shown", "Production notification_received to quick_edit_shown window-focus telemetry; card/OS external delivery excluded.")
                    .put("android.quick-edit.notification-to-ready", "Listener invocation to focused, drawn merchant/amount/selected category/save-ready view; includes <=20ms observation polling and one frame.")
                    .put("android.quick-edit.save-to-closed", "Actual save performClick to QuickEdit Activity onDestroyed; includes the real close transition.")
                    .put("android.quick-edit.save-to-server-observed", "Save click to authenticated query confirming exact memo/category/amount; upper bound includes observation query roundtrip and <=50ms polling."))
                .put("samples", samples).toString(), Charsets.UTF_8)
        } finally {
            HouseholdPreferences.clearHouseholdKey(context)
            auth.signOut()
            if (!oldOverlay) shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW deny")
            if (oldListeners.isNullOrBlank()) shell("settings delete secure enabled_notification_listeners")
            else shell("settings put secure enabled_notification_listeners $oldListeners")
        }
    }

    private suspend fun measureQuickEdit(fixture: JSONObject, repetitions: Int) {
        val raw = RawNotificationEnvelopeV1.fromJson(fixture.getJSONObject("rawNotification").toString())
        val listener = CardNotificationListenerService()
        ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java).apply { isAccessible = true }.invoke(listener, context)
        val monitor = instrumentation.addMonitor(QuickEditActivity::class.java.name, null, false)
        val destroyedAt = ConcurrentHashMap<android.app.Activity, Long>()
        val callbacks = object : Application.ActivityLifecycleCallbacks {
            override fun onActivityDestroyed(activity: android.app.Activity) { if (activity is QuickEditActivity) destroyedAt[activity] = SystemClock.elapsedRealtime() }
            override fun onActivityCreated(activity: android.app.Activity, state: Bundle?) = Unit
            override fun onActivityStarted(activity: android.app.Activity) = Unit
            override fun onActivityResumed(activity: android.app.Activity) = Unit
            override fun onActivityPaused(activity: android.app.Activity) = Unit
            override fun onActivityStopped(activity: android.app.Activity) = Unit
            override fun onActivitySaveInstanceState(activity: android.app.Activity, state: Bundle) = Unit
        }
        val application = context.applicationContext as Application
        application.registerActivityLifecycleCallbacks(callbacks)
        var current: QuickEditActivity? = null
        try {
            repeat(repetitions + 1) { index ->
                val amount = 41000 + index
                val notification = Notification.Builder(context, "e2e-card-performance").build().apply {
                    extras.putCharSequence(Notification.EXTRA_TITLE, raw.notification.title)
                    extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES,
                        raw.notification.textLines.mapIndexed { lineIndex, line -> if (lineIndex == 0) "${amount}원 일시불" else line }.toTypedArray())
                }
                @Suppress("DEPRECATION")
                val external = StatusBarNotification(raw.packageName, raw.packageName, 100 + index, "performance-$index", Process.myUid(),
                    Process.myPid(), 0, notification, Process.myUserHandle(), Instant.parse(raw.notification.postedAt).toEpochMilli() + index)
                shell("logcat -c")
                val notifiedAt = SystemClock.elapsedRealtime()
                listener.onNotificationPosted(external)
                val previous = current
                do { current = monitor.waitForActivityWithTimeout(60_000) as? QuickEditActivity } while (current != null && current === previous)
                val opened = checkNotNull(current) { "Actual notification listener must launch QuickEditActivity" }
                eventually("Focused Quick Edit with correct server selected category", pollMs = 20) {
                    var ready = false
                    instrumentation.runOnMainSync {
                        val categories = opened.findViewById<FlexboxLayout>(R.id.categoryContainer)
                        val selected = (0 until categories.childCount).map(categories::getChildAt).filter(View::isSelected)
                        ready = opened.hasWindowFocus() && opened.window.decorView.isShown &&
                            opened.findViewById<EditText>(R.id.etMerchant).text.toString() == fixture.getString("expectedMerchant") &&
                            opened.findViewById<EditText>(R.id.etAmount).text.toString() == amount.toString() &&
                            selected.size == 1 && selected.single().texts().contains(fixture.getString("categoryName").substringBefore('/')) &&
                            opened.findViewById<View>(R.id.btnSave).isEnabled
                    }
                    ready
                }
                val readyAt = suspendCancellableCoroutine<Long> { continuation ->
                    instrumentation.runOnMainSync {
                        opened.window.decorView.postOnAnimation { if (continuation.isActive) continuation.resume(SystemClock.elapsedRealtime()) }
                    }
                }
                val log = shell("logcat -d --pid=${Process.myPid()} -s HHCaptureLatency:I")
                val shown = Regex("stage=quick_edit_shown[^\\r\\n]* totalMs=(\\d+)").find(log)
                assertNotNull("Actual capture receipt must emit notification-to-window-focus summary", shown)
                sample("android.quick-edit.notification-to-shown", index - 1, checkNotNull(shown).groupValues[1].toDouble(), warmup = index == 0)
                sample("android.quick-edit.notification-to-ready", index - 1, (readyAt - notifiedAt).toDouble(), warmup = index == 0)
                val transactionId = checkNotNull(opened.intent.getStringExtra(QuickEditActivity.EXTRA_EXPENSE_ID))
                val memo = "Native performance $index"
                val savedAt = AtomicLong()
                instrumentation.runOnMainSync {
                    opened.findViewById<EditText>(R.id.etMemo).setText(memo)
                    savedAt.set(SystemClock.elapsedRealtime())
                    assertTrue(opened.findViewById<View>(R.id.btnSave).performClick())
                }
                val query = CallableLedgerTransactionQueryClient(FirebaseAuthenticatedCallableGateway())
                eventually("Actual server committed Quick Edit", pollMs = 50) {
                    val result = query.get(fixture.getString("householdId"), transactionId) as? LedgerTransactionQueryResult.Success
                    result?.value?.let { it.memo == memo && it.categoryId == fixture.getString("categoryId") && it.amountInWon == amount } == true
                }
                sample("android.quick-edit.save-to-server-observed", index - 1, (SystemClock.elapsedRealtime() - savedAt.get()).toDouble(), warmup = index == 0)
                eventually("QuickEdit Activity destroyed", pollMs = 20) { destroyedAt.containsKey(opened) }
                sample("android.quick-edit.save-to-closed", index - 1, (destroyedAt.remove(opened)!! - savedAt.get()).toDouble(), warmup = index == 0)
                eventually("Outbox and FIFO drained before next independent notification") {
                    AndroidKeystoreQuickEditCommandOutboxStore(context).load().isEmpty() && AndroidKeystoreQuickEditQueueStore(context).load().entries.isEmpty()
                }
            }
        } finally {
            instrumentation.removeMonitor(monitor)
            application.unregisterActivityLifecycleCallbacks(callbacks)
            current?.let { activity -> instrumentation.runOnMainSync { if (!activity.isFinishing) activity.finish() } }
        }
    }

    private fun sample(metric: String, iteration: Int, durationMs: Double, warmup: Boolean = false) {
        assertTrue("$metric must use a real positive clock interval", durationMs.isFinite() && durationMs >= 0)
        val label = when (metric) {
            "android.home.activity-reopen-complete" -> "Android 앱 재실행 → 첫 홈 데이터 표시"
            "android.home.isolated-activity-complete" -> "Android 첫 홈 (이전 WebView 테스트 정리 진단)"
            "android.quick-edit.notification-to-shown" -> "결제 알림 수신 → Quick Edit 창 표시"
            "android.quick-edit.notification-to-ready" -> "결제 알림 수신 → Quick Edit 편집 준비"
            "android.quick-edit.save-to-closed" -> "Quick Edit 저장 → 창 닫힘"
            "android.quick-edit.save-to-server-observed" -> "Quick Edit 저장 → 서버 저장 확인"
            else -> error("Unknown measurement: $metric")
        }
        samples.put(JSONObject().put("project", "android-emulator").put("metric", metric)
            .put("cacheState", when (metric) {
                "android.home.activity-reopen-complete" -> "warm-process-production-activity-close"
                "android.home.isolated-activity-complete" -> "diagnostic-warm-process-test-disposed-webview"
                else -> "warm-after-first-notification"
            })
            .put("label", label).put("warmup", warmup).put("iteration", iteration + 1).put("durationMs", durationMs))
    }

    private suspend fun homeReady(web: WebView, expectedMonthlyAmount: Int) = evaluate(web,
        "Boolean(document.querySelector('.calendar-glass[aria-busy=\"false\"]') && document.body.innerText.includes('25,789') && document.body.innerText.includes(($expectedMonthlyAmount).toLocaleString()) && performance.getEntriesByName('household-account:startup:home:first-complete-paint').length===1)") == true

    private suspend fun evaluate(web: WebView, script: String): Any? = suspendCancellableCoroutine { continuation ->
        instrumentation.runOnMainSync { web.evaluateJavascript(script) { result -> if (continuation.isActive) continuation.resume(JSONTokener(result).nextValue()) } }
    }

    /** Test sample isolation only, after the measured completion. Product lifecycle remains intact. */
    private fun disposeMeasuredDocument(web: WebView) {
        instrumentation.runOnMainSync {
            web.stopLoading()
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
    }

    private suspend fun eventually(description: String, pollMs: Long = 100, check: suspend () -> Boolean) {
        try { withTimeout(90_000) { while (!check()) delay(pollMs) } }
        catch (error: kotlinx.coroutines.TimeoutCancellationException) { throw AssertionError(description, error) }
    }

    private fun shell(command: String) = instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
        FileInputStream(descriptor.fileDescriptor).use { it.readBytes().toString(Charsets.UTF_8) }
    }

    private fun writeFixture(path: String, fields: JSONObject) {
        val connection = URL("http://10.0.2.2:8080/v1/projects/${FirebaseEmulatorTestRunner.PROJECT_ID}/databases/(default)/documents/$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "PATCH"
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.setRequestProperty("Authorization", "Bearer owner")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use { it.write(JSONObject().put("fields", fields).toString().toByteArray()) }
            check(connection.responseCode == 200) { "Local emulator fixture failed: ${connection.responseCode}" }
        } finally { connection.disconnect() }
    }

    private fun View.texts(): List<String> = buildList {
        if (this@texts is TextView) add(text.toString())
        if (this@texts is ViewGroup) for (index in 0 until childCount) addAll(getChildAt(index).texts())
    }
}
