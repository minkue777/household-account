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
                WebViewCompat.addDocumentStartJavaScript(webView, OBSERVE_REAL_OPERATIONS, setOf(origin))
                assertTrue(webView.url.isNullOrBlank())
            }
            suspend fun evaluate(script: String): Any? = suspendCancellableCoroutine { continuation ->
                instrumentation.runOnMainSync {
                    webView.evaluateJavascript(script) { value -> if (continuation.isActive) continuation.resume(JSONTokener(value).nextValue()) }
                }
            }
            // A real pre-navigation interval proves the metric includes Activity startup, not just Web timing.
            delay(750)
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
            eventually("Real server home data and paint command accepted") {
                evaluate("Boolean(document.querySelector('.calendar-glass[aria-busy=\"false\"]') && document.body.innerText.includes('25,789') && window.nativeE2e?.commands.some(x=>x.command==='access.record-app-visit.v1' && typeof x.payload.clientStartupDurationMs==='number' && x.success))") == true
            }
            val first = JSONObject(evaluate("JSON.stringify(window.nativeE2e)").toString())
            val startup = first.getJSONArray("commands").let { commands ->
                (0 until commands.length()).map(commands::getJSONObject).single { it.getJSONObject("payload").has("clientStartupDurationMs") }
            }
            val duration = startup.getJSONObject("payload").getDouble("clientStartupDurationMs")
            assertEquals("android", startup.getJSONObject("payload").getString("platform"))
            assertTrue(duration >= beforeNavigationElapsed)
            assertTrue(duration <= SystemClock.elapsedRealtime() - startedAt)
            assertTrue("Native measurement includes the real phase before Web navigation", duration - startup.getDouble("completePaintAt") >= beforeNavigationElapsed - 250)
            val databases = first.getJSONArray("databases").let { entries -> (0 until entries.length()).map(entries::getString) }
            assertTrue("Android Firestore must use memory cache", databases.none { it.startsWith("firestore/") })
            val firstDocumentId = first.getString("documentId")
            balance(36890)
            active.onActivity { webView.reload() }
            eventually("Same Activity reload creates a new real document with newest server balance") {
                evaluate("Boolean(window.nativeE2e && window.nativeE2e.documentId !== ${JSONObject.quote(firstDocumentId)} && document.querySelector('.calendar-glass[aria-busy=\"false\"]') && document.body.innerText.includes('36,890') && window.nativeE2e.commands.some(x=>x.command==='access.record-app-visit.v1' && x.success))") == true
            }
            val reloaded = JSONObject(evaluate("JSON.stringify(window.nativeE2e)").toString())
            val commands = reloaded.getJSONArray("commands")
            assertTrue((0 until commands.length()).map(commands::getJSONObject).none { it.getJSONObject("payload").has("clientStartupDurationMs") })
            assertTrue(evaluate("performance.getEntriesByName('household-account:startup:home:first-complete-paint').length === 1") == true)
            File(context.filesDir, "native-startup-e2e-result.json").writeText(JSONObject()
                .put("platform", "android").put("durationMs", duration)
                .put("beforeNavigationElapsedMs", beforeNavigationElapsed).put("sameActivityReloadStartupSamples", 0)
                .put("latestLocalCurrencyBalance", 36890).toString())
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
        // Observers preserve all SDK requests and responses and never provide domain results or clocks.
        private const val OBSERVE_REAL_OPERATIONS = """
            (() => {
              const observation = window.nativeE2e = { documentId: crypto.randomUUID(), commands: [], databases: [] };
              const open = IDBFactory.prototype.open;
              IDBFactory.prototype.open = function(...args) { observation.databases.push(args[0]); return Reflect.apply(open, this, args); };
              const originalFetch = window.fetch;
              window.fetch = async function(...args) {
                const response = await Reflect.apply(originalFetch, this, args);
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
