package com.household.account.e2e

import android.Manifest
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.household.account.MainActivity
import com.household.account.R
import com.household.account.util.HouseholdPreferences
import com.household.account.webhost.TrustedWebOrigin
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
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

/** Real MainActivity clock + origin-bound bridge + served Next application + actual Firebase SDK. */
@FirebaseEmulatorE2E
@RunWith(AndroidJUnit4::class)
class WebStartupFirebaseE2ETest {
    @Test fun realHomePaintReportsActivityElapsedOnceAndReloadKeepsMemoryCacheServerFresh() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val arguments = InstrumentationRegistry.getArguments()
        val origin = checkNotNull(arguments.getString("webOrigin")) { "Native Web E2E requires its local HTTPS server" }
        check(origin == "https://localhost:3443" && TrustedWebOrigin.APP_ORIGIN == origin)
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val fixture = JSONObject(String(android.util.Base64.decode(checkNotNull(arguments.getString("fixtureBase64")), android.util.Base64.DEFAULT), Charsets.UTF_8))
        val householdId = fixture.getString("householdId")
        val memberId = fixture.getString("memberId")
        val auth = FirebaseAuth.getInstance()
        val oldOverlay = Settings.canDrawOverlays(context)
        val oldListeners = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        fun shell(command: String) = instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            FileInputStream(descriptor.fileDescriptor).use { it.readBytes().toString(Charsets.UTF_8) }
        }
        suspend fun eventually(description: String, check: suspend () -> Boolean) {
            try { withTimeout(90_000) { while (!check()) delay(100) } }
            catch (error: kotlinx.coroutines.TimeoutCancellationException) { throw AssertionError(description, error) }
        }
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            withTimeout(30_000) { auth.signInWithEmailAndPassword(fixture.getString("email"), fixture.getString("password")).await() }
            HouseholdPreferences.replaceAuthenticatedSession(context, householdId, memberId, "Web startup E2E")
            writeFixture("households/$householdId/homePreferences/home", JSONObject()
                .put("left", JSONObject().put("stringValue", "MONTHLY_EXPENSE"))
                .put("right", JSONObject().put("stringValue", "LOCAL_CURRENCY_BALANCE"))
                .put("selectedLocalCurrencyType", JSONObject().put("stringValue", "gyeonggi"))
                .put("aggregateVersion", JSONObject().put("integerValue", "1")))
            fun balance(value: Int) = writeFixture("households/$householdId/localCurrencyBalances/gyeonggi", JSONObject()
                .put("localCurrencyType", JSONObject().put("stringValue", "gyeonggi"))
                .put("balanceInWon", JSONObject().put("integerValue", value.toString())))
            balance(25789)
            // Validate a normal cold launch first, then isolate the repeat-launch Lite success path.
            // Cold code/auth preparation may legitimately exhaust the unchanged 750ms budget.
            for (preparing in listOf(true, false)) {
                shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW deny")
                eventually("Permission guide must precede the real navigation") { !Settings.canDrawOverlays(context) }
                scenario = ActivityScenario.launch(MainActivity::class.java)
                val active = scenario
                lateinit var webView: WebView
                var startedAt = 0L
                active.onActivity { activity ->
                    webView = activity.findViewById(R.id.webView)
                    val clock = MainActivity::class.java.getDeclaredField("appLaunchDurationClock").apply { isAccessible = true }.get(activity)
                    startedAt = clock.javaClass.getDeclaredField("startedAtMillis").apply { isAccessible = true }.getLong(clock)
                    check(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
                    val observationScript = OBSERVE_REAL_OPERATIONS.replace("native-startup-listen-released",
                        "native-startup-listen-released-${SystemClock.elapsedRealtime()}")
                        .replace("__HOLD_LISTEN__", (!preparing).toString())
                        .replace("native-startup-hold-lite", "native-startup-hold-lite-${SystemClock.elapsedRealtime()}")
                    WebViewCompat.addDocumentStartJavaScript(webView, observationScript, setOf(origin))
                    assertTrue(webView.url.isNullOrBlank())
                }
                suspend fun evaluate(script: String): Any? = suspendCancellableCoroutine { continuation ->
                    instrumentation.runOnMainSync {
                        webView.evaluateJavascript(script) { value -> if (continuation.isActive) continuation.resume(JSONTokener(value).nextValue()) }
                    }
                }
                // A real pre-navigation interval proves the metric includes Activity startup, not just Web timing.
                if (!preparing) delay(750)
                val beforeNavigationElapsed = SystemClock.elapsedRealtime() - startedAt
                shell("settings put secure enabled_notification_listeners ${context.packageName}/com.household.account.service.CardNotificationListenerService")
                shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW allow")
                if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
                eventually("Required permissions applied") { Settings.canDrawOverlays(context) }
                active.onActivity { it.findViewById<android.view.View>(R.id.btnCheckPermission).performClick() }
                eventually("Actual application login button or authenticated calendar") {
                    evaluate("Boolean(document.querySelector('.calendar-glass') || [...document.querySelectorAll('button')].some(b=>b.textContent.includes('테스트 계정으로 로그인')))") == true
                }
                evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('테스트 계정으로 로그인'))?.click();true")
                try {
                    eventually("Real server home data and paint command accepted (preparing=$preparing)") {
                        evaluate("Boolean(document.querySelector('.calendar-glass[aria-busy=\"false\"]') && document.body.innerText.includes('25,789') && window.nativeE2e?.commands.some(x=>x.command==='access.record-app-visit.v1' && typeof x.payload.clientStartupDurationMs==='number' && x.success))") == true
                    }
                } catch (error: AssertionError) {
                    val observation = evaluate("JSON.stringify({calendarBusy:document.querySelector('.calendar-glass')?.getAttribute('aria-busy'),expectedBalance:document.body.innerText.includes('25,789'),heldListen:window.nativeE2e?.heldListenRequests,liteResponses:window.nativeE2e?.liteResponses,requests:window.nativeE2e?.requests,marks:performance.getEntriesByType('mark').map(x=>({name:x.name,atMs:x.startTime}))})")
                    android.util.Log.e("NativeStartupE2E", "Startup failed (preparing=$preparing): $observation")
                    throw error
                }
                val first = JSONObject(evaluate("JSON.stringify(window.nativeE2e)").toString())
                if (preparing) {
                    File(context.filesDir, "native-startup-cold-e2e-result.json").writeText(first.toString())
                    active.close()
                    scenario = null
                    continue
                }
                val startup = first.getJSONArray("commands").let { commands ->
                    (0 until commands.length()).map(commands::getJSONObject).single { it.getJSONObject("payload").has("clientStartupDurationMs") }
                }
                val duration = startup.getJSONObject("payload").getDouble("clientStartupDurationMs")
                assertEquals("android", startup.getJSONObject("payload").getString("platform"))
                assertTrue(duration >= beforeNavigationElapsed)
                assertTrue(duration <= SystemClock.elapsedRealtime() - startedAt)
                assertTrue("Native measurement includes the real phase before Web navigation", duration - startup.getDouble("completePaintAt") >= beforeNavigationElapsed - 250)
                val diagnostics = startup.getJSONObject("payload").getJSONObject("clientStartupDiagnostics")
                val androidTiming = diagnostics.getJSONObject("android")
                val nativeTiming = androidTiming.getJSONObject("nativeTimingsMs")
                val webDuration = androidTiming.getDouble("webDurationMs")
                assertTrue(nativeTiming.getDouble("webViewReady") <= beforeNavigationElapsed)
                assertTrue(nativeTiming.getDouble("navigationRequested") >= beforeNavigationElapsed)
                assertTrue(nativeTiming.getDouble("navigationRequested") <= duration)
                assertTrue(androidTiming.getDouble("bridgeRoundTripMs") >= 0)
                val webTiming = diagnostics.getJSONObject("timingsMs")
                for (key in listOf("bootstrapStarted", "authStarted", "authReady", "homeReady", "firstHomeCompletePaint")) {
                    assertTrue("$key must be observed before Web completion", webTiming.getDouble(key) in 0.0..webDuration)
                }
                for ((source, ready) in listOf("ledger" to "ledgerReady", "categories" to "categoriesReady",
                    "currencyPreferences" to "localCurrencyReady", "currencyBalances" to "localCurrencyReady")) {
                    val initialStart = webTiming.getDouble(source + "InitialReadStarted")
                    val initialReceived = webTiming.getDouble(source + "InitialReadReceived")
                    assertTrue(initialStart in 0.0..initialReceived)
                    assertTrue(initialReceived <= webTiming.getDouble(ready))
                    assertTrue(webTiming.getDouble(ready) <= webTiming.getDouble("homeReady"))
                    assertTrue(webTiming.getDouble(source + "ListenStarted") >= initialReceived)
                    assertFalse("Held Listen must not supply the first home", webTiming.has(source + "ServerSnapshotReceived"))
                    assertFalse("Actual Lite requests must succeed within the existing budget", webTiming.has(source + "InitialReadFallback"))
                }
                assertEquals(startup.getDouble("completePaintAt"), webTiming.getDouble("firstHomeCompletePaint"), 0.01)
                assertTrue("Real Listen transport must have been held", first.getInt("heldListenRequests") > 0)
                assertTrue("Actual Lite query and document responses must arrive", first.getInt("liteResponses") >= 4)
                val databases = first.getJSONArray("databases").let { entries -> (0 until entries.length()).map(entries::getString) }
                assertTrue("Android Firestore must use memory cache", databases.none { it.startsWith("firestore/") })
                val firstDocumentId = first.getString("documentId")
                evaluate("window.nativeE2e.releaseListen();true")
                balance(30000)
                eventually("Live subscription after Lite must reflect another real server change") {
                    evaluate("document.body.innerText.includes('30,000')") == true
                }
                balance(36890)
                evaluate("window.nativeE2e.holdLiteOnNextDocument();true")
                active.onActivity { webView.reload() }
                eventually("Same Activity reload creates a new real document with newest server balance") {
                    evaluate("Boolean(window.nativeE2e && window.nativeE2e.documentId !== ${JSONObject.quote(firstDocumentId)} && document.querySelector('.calendar-glass[aria-busy=\"false\"]') && document.body.innerText.includes('36,890') && window.nativeE2e.commands.some(x=>x.command==='access.record-app-visit.v1' && x.success))") == true
                }
                val reloaded = JSONObject(evaluate("JSON.stringify(window.nativeE2e)").toString())
                val commands = reloaded.getJSONArray("commands")
                assertTrue((0 until commands.length()).map(commands::getJSONObject).none { it.getJSONObject("payload").has("clientStartupDurationMs") })
                assertTrue(evaluate("performance.getEntriesByName('household-account:startup:home:first-complete-paint').length === 1") == true)
                eventually("Reload must use real subscriptions while all four late Lite responses remain held") {
                    evaluate("window.nativeE2e.heldLiteResponses >= 4 && window.nativeE2e.listenRequests > 0") == true
                }
                balance(47901)
                eventually("Live data must advance beyond the held Lite response") {
                    evaluate("document.body.innerText.includes('47,901')") == true
                }
                evaluate("window.nativeE2e.releaseLite();true")
                eventually("All actual delayed Lite responses are released") {
                    evaluate("window.nativeE2e.releasedLiteResponses >= 4") == true
                }
                evaluate("requestAnimationFrame(() => requestAnimationFrame(() => { window.nativeE2e.latePaintChecked = true; }));true")
                eventually("Late-response microtasks and the next paint completed") {
                    evaluate("window.nativeE2e.latePaintChecked === true") == true
                }
                assertTrue("Late Lite data must never overwrite the newer live result", evaluate("document.body.innerText.includes('47,901') && !document.body.innerText.includes('36,890')") == true)
                File(context.filesDir, "native-startup-e2e-result.json").writeText(JSONObject()
                    .put("platform", "android").put("durationMs", duration)
                    .put("diagnostics", diagnostics)
                    .put("beforeNavigationElapsedMs", beforeNavigationElapsed).put("sameActivityReloadStartupSamples", 0)
                    .put("latestLocalCurrencyBalance", 36890).put("lateLiteRetainedBalance", 47901).toString())
            }
        } finally {
            scenario?.close()
            HouseholdPreferences.clearHouseholdKey(context)
            auth.signOut()
            if (!oldOverlay) shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW deny")
            if (oldListeners.isNullOrBlank()) shell("settings delete secure enabled_notification_listeners")
            else shell("settings put secure enabled_notification_listeners $oldListeners")
        }
    }

    private fun writeFixture(path: String, fields: JSONObject) {
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val connection = URL("http://10.0.2.2:8080/v1/projects/${FirebaseEmulatorTestRunner.PROJECT_ID}/databases/(default)/documents/$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "PATCH"
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.setRequestProperty("Authorization", "Bearer owner")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use { it.write(JSONObject().put("fields", fields).toString().toByteArray()) }
            check(connection.responseCode == 200) { "Local Emulator setup failed: ${connection.responseCode}" }
        } finally { connection.disconnect() }
    }

    companion object {
        // Hold only Listen transport until the first real home; do not fabricate SDK results or clocks.
        private const val OBSERVE_REAL_OPERATIONS = """
            (() => {
              const observation = window.nativeE2e = { documentId: crypto.randomUUID(), commands: [], databases: [], heldListenRequests: 0, listenRequests: 0, liteResponses: 0, heldLiteResponses: 0, releasedLiteResponses: 0, requests: [] };
              let holding = __HOLD_LISTEN__ && sessionStorage.getItem('native-startup-listen-released') !== 'true';
              let holdingLite = sessionStorage.getItem('native-startup-hold-lite') === 'true';
              const lateResponses = [];
              observation.holdLiteOnNextDocument = () => sessionStorage.setItem('native-startup-hold-lite', 'true');
              observation.releaseLite = () => {
                holdingLite = false;
                sessionStorage.removeItem('native-startup-hold-lite');
                lateResponses.splice(0).forEach(resume => resume());
              };
              const waiting = [];
              const isListen = url => String(url).includes('/google.firestore.v1.Firestore/Listen/channel');
              observation.releaseListen = () => {
                holding = false;
                sessionStorage.setItem('native-startup-listen-released', 'true');
                waiting.splice(0).forEach(resume => resume());
              };
              const urls = new WeakMap();
              const xhrOpen = XMLHttpRequest.prototype.open;
              const xhrSend = XMLHttpRequest.prototype.send;
              XMLHttpRequest.prototype.open = function(...args) { urls.set(this, args[1]); return Reflect.apply(xhrOpen, this, args); };
              XMLHttpRequest.prototype.send = function(...args) {
                if (isListen(urls.get(this))) observation.listenRequests++;
                if (holding && isListen(urls.get(this))) {
                  observation.heldListenRequests++;
                  waiting.push(() => { if (this.readyState === 1) Reflect.apply(xhrSend, this, args); });
                  return;
                }
                return Reflect.apply(xhrSend, this, args);
              };
              const open = IDBFactory.prototype.open;
              IDBFactory.prototype.open = function(...args) { observation.databases.push(args[0]); return Reflect.apply(open, this, args); };
              const originalFetch = window.fetch;
              window.fetch = async function(...args) {
                const url = String(args[0]?.url || args[0]);
                const lite = /\/documents(?:\/[^?]+)?:runQuery|\/documents:batchGet/.test(url);
                const observed = lite ? { kind: url.includes(':runQuery') ? 'runQuery' : 'batchGet', startedAt: performance.now() } : undefined;
                if (observed) observation.requests.push(observed);
                if (isListen(url)) observation.listenRequests++;
                if (holding && isListen(url)) {
                  observation.heldListenRequests++;
                  await new Promise(resolve => waiting.push(resolve));
                }
                const response = await Reflect.apply(originalFetch, this, args);
                if (observed) { observed.responseAt = performance.now(); observed.status = response.status; }
                if (response.ok && lite) {
                  observation.liteResponses++;
                  if (holdingLite) {
                    observation.heldLiteResponses++;
                    await new Promise(resolve => lateResponses.push(resolve));
                    observation.releasedLiteResponses++;
                  }
                }
                const body = args[1]?.body;
                if (typeof body === 'string' && String(args[0]).includes('executeHouseholdCommand')) {
                  try {
                    const request = JSON.parse(body).data;
                    if (request?.command === 'access.record-app-visit.v1') {
                      response.clone().json().then(result => observation.commands.push({ command: request.command, payload: request.payload,
                        completePaintAt: performance.getEntriesByName('household-account:startup:home:first-complete-paint')[0]?.startTime,
                        success: response.ok && ['succeeded', 'already-processed'].includes(result.result?.result?.kind) }));
                    }
                  } catch {}
                }
                return response;
              };
            })();
        """
    }
}
