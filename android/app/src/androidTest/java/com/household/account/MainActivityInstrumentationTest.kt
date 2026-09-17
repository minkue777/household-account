package com.household.account

import android.content.ComponentName
import android.content.Context
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.util.AttributeSet
import android.view.LayoutInflater
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.widget.Button
import android.widget.LinearLayout
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleCallback
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.household.account.service.CardNotificationListenerService
import com.household.account.paymentcapture.AndroidCaptureDelivery
import com.household.account.webhost.AndroidHostBridge
import com.household.account.webhost.TrustedWebOrigin
import com.household.account.webhost.NotificationListenerAccess
import com.household.account.util.HouseholdPreferences
import java.io.FileInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import androidx.lifecycle.Lifecycle
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.json.JSONTokener
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.matcher.ViewMatchers.withId
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityInstrumentationTest {
    private lateinit var context: Context
    private lateinit var notificationListener: ComponentName

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        notificationListener = ComponentName(context, CardNotificationListenerService::class.java)
        context.getSharedPreferences("android_permission_prompts", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("postNotificationsRequested", true)
            .commit()
        revokeMandatoryPermissions()
        waitUntil("필수 권한 해제") {
            !Settings.canDrawOverlays(context) && !isNotificationListenerEnabled()
        }
    }

    @After
    fun tearDown() {
        revokeMandatoryPermissions()
        context.getSharedPreferences("android_permission_prompts", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    @Test
    fun missingMandatoryPermissionsShowSetupWithoutStartingTheWebPage() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val permissionLayout =
                    activity.findViewById<LinearLayout>(R.id.permissionLayout)
                val webView = activity.findViewById<WebView>(R.id.webView)
                val notificationPermission =
                    activity.findViewById<Button>(R.id.btnRequestPermission)
                val overlayPermission =
                    activity.findViewById<Button>(R.id.btnRequestOverlayPermission)

                assertEquals(View.VISIBLE, permissionLayout.visibility)
                assertEquals(View.GONE, webView.visibility)
                assertEquals(View.VISIBLE, notificationPermission.visibility)
                assertEquals(View.VISIBLE, overlayPermission.visibility)
                assertTrue(notificationPermission.isEnabled)
                assertTrue(overlayPermission.isEnabled)
                assertEquals(null, webView.url)
                assertTrue(webView.settings.javaScriptEnabled)
                assertTrue(webView.settings.domStorageEnabled)
                assertFalse(webView.settings.allowFileAccess)
                assertFalse(webView.settings.allowContentAccess)
                assertEquals(
                    WebSettings.MIXED_CONTENT_NEVER_ALLOW,
                    webView.settings.mixedContentMode
                )
                assertFalse(webView.settings.javaScriptCanOpenWindowsAutomatically)
                assertFalse(webView.settings.supportMultipleWindows())
            }
        }
    }

    @Test
    fun grantedMandatoryPermissionsStartTheTrustedWebPage() {
        grantMandatoryPermissions()
        waitUntil("필수 권한 허용") {
            Settings.canDrawOverlays(context) && isNotificationListenerEnabled()
        }

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(View.VISIBLE, activity.findViewById<WebView>(R.id.webView).visibility)
                assertEquals(
                    View.GONE,
                    activity.findViewById<LinearLayout>(R.id.permissionLayout).visibility
                )
            }

            waitUntil("신뢰된 가계부 URL 로드") {
                var loadedUrl: String? = null
                var originalUrl: String? = null
                scenario.onActivity { activity ->
                    val webView = activity.findViewById<WebView>(R.id.webView)
                    loadedUrl = webView.url
                    originalUrl = webView.originalUrl
                }
                loadedUrl == TrustedWebOrigin.APP_URL ||
                    originalUrl == TrustedWebOrigin.APP_URL
            }
        }
    }

    @Test
    fun deniedPushPermissionDoesNotBlockWebAndIsNotRequestedAgainAfterRecreation() {
        assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
        executeShellCommand("pm revoke ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
        executeShellCommand("pm set-permission-flags ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS} user-set")
        grantMandatoryPermissions()
        waitUntil("필수 권한 허용") {
            Settings.canDrawOverlays(context) && isNotificationListenerEnabled()
        }

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            assertEquals(PackageManager.PERMISSION_DENIED,
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
            assertTrue(context.getSharedPreferences("android_permission_prompts", Context.MODE_PRIVATE)
                .getBoolean("postNotificationsRequested", false))

            scenario.recreate()
            scenario.onActivity { activity ->
                assertEquals(View.VISIBLE, activity.findViewById<WebView>(R.id.webView).visibility)
                assertEquals(View.GONE, activity.findViewById<LinearLayout>(R.id.permissionLayout).visibility)
                activity.findViewById<Button>(R.id.btnCheckPermission).performClick()
            }
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            assertEquals(PackageManager.PERMISSION_DENIED,
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
            assertTrue(context.getSharedPreferences("android_permission_prompts", Context.MODE_PRIVATE)
                .getBoolean("postNotificationsRequested", false))
            assertTrue(Settings.canDrawOverlays(context))
            assertTrue(isNotificationListenerEnabled())
        }
    }

    @Test
    fun captureRetryChecksTheSessionOutsideTheMainThread() {
        val checked = CountDownLatch(1)
        val ranOnMainThread = AtomicBoolean(true)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                AndroidCaptureDelivery.scheduleRetry(activity.applicationContext) {
                    ranOnMainThread.set(android.os.Looper.myLooper() == android.os.Looper.getMainLooper())
                    checked.countDown()
                    false // No worker or remote capture is needed for this thread-boundary check.
                }
            }
            assertTrue(checked.await(5, TimeUnit.SECONDS))
            assertFalse(ranOnMainThread.get())
        }
    }

    @Test
    fun finishingActivityDetachesAndDestroysItsWebViewOnce() {
        withObservedWebViewLifecycle { scenario ->
            loadLifecycleDocument(scenario)
            lateinit var original: LifecycleObservedWebView
            scenario.onActivity { activity ->
                original = activity.findViewById(R.id.webView)
                assertEquals(0, original.destroyCalls)
                assertTrue(original.parent != null)
                activity.finish()
            }
            waitUntil("Activity 종료 후 WebView 해제") {
                scenario.state == Lifecycle.State.DESTROYED
            }
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                assertNull(original.parent)
                assertEquals(1, original.destroyCalls)
                assertTrue(original.wasDetachedAtDestroy)
            }
        }
    }

    @Test
    fun backgroundPreservesTheDocumentAndRecreationReleasesOnlyTheOldWebView() {
        withObservedWebViewLifecycle { scenario ->
            loadLifecycleDocument(scenario)
            lateinit var original: LifecycleObservedWebView
            grantMandatoryPermissions()
            scenario.onActivity { activity ->
                original = activity.findViewById(R.id.webView)
                activity.findViewById<Button>(R.id.btnCheckPermission).performClick()
            }
            evaluateWebView(scenario, "window.unsavedDraft = 'keep-before-background'")

            scenario.moveToState(Lifecycle.State.CREATED)
            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity { activity ->
                assertSame(original, activity.findViewById(R.id.webView))
                assertEquals(0, original.destroyCalls)
                assertTrue(original.parent != null)
            }
            assertEquals("keep-before-background", evaluateWebViewText(scenario, "window.unsavedDraft"))
            assertEquals("1", evaluateWebView(scenario, "window.resumeEvents"))

            scenario.recreate()
            scenario.onActivity { activity ->
                val replacement = activity.findViewById<LifecycleObservedWebView>(R.id.webView)
                assertNotSame(original, replacement)
                assertNull(original.parent)
                assertEquals(1, original.destroyCalls)
                assertTrue(original.wasDetachedAtDestroy)
                assertEquals(0, replacement.destroyCalls)
                assertEquals(View.VISIBLE, replacement.visibility)
            }
            // Exercise the new real renderer and production bridge, independently of remote hosting.
            loadLifecycleDocument(scenario)
            assertEquals("undefined", evaluateWebViewText(scenario, "typeof window.unsavedDraft"))
        }
    }

    @Test
    fun foregroundRendererCrashKeepsActivityAndRestoresTrustedPageAndCookie() {
        assumeRendererTerminationSupported()
        grantMandatoryPermissions()
        waitUntil("필수 권한 허용") {
            Settings.canDrawOverlays(context) && isNotificationListenerEnabled()
        }
        val recoveryUrl = "${TrustedWebOrigin.APP_ORIGIN}/native-test/renderer-recovery"
        val cookieName = "native_renderer_recovery_test"
        setRecoveryCookie("$cookieName=preserved; Path=/; SameSite=Lax")
        try {
            withObservedWebViewLifecycle { scenario ->
                loadLifecycleDocument(scenario, recoveryUrl)
                lateinit var originalActivity: MainActivity
                lateinit var original: LifecycleObservedWebView
                scenario.onActivity { activity ->
                    originalActivity = activity
                    original = activity.findViewById(R.id.webView)
                }

                InstrumentationRegistry.getInstrumentation().runOnMainSync {
                    original.loadUrl("chrome://crash")
                }
                waitUntil("전경 renderer 종료 후 새 WebView 복구", 10_000) {
                    var restored = false
                    scenario.onActivity { activity ->
                        assertSame(originalActivity, activity)
                        assertFalse(activity.isFinishing)
                        val replacement = activity.findViewById<WebView>(R.id.webView)
                        restored = replacement != null && replacement !== original &&
                            (replacement.url == recoveryUrl || replacement.originalUrl == recoveryUrl)
                    }
                    restored
                }
                scenario.onActivity { activity ->
                    assertNull(original.parent)
                    assertEquals(1, original.destroyCalls)
                    assertTrue(original.wasDetachedAtDestroy)
                    assertEquals(View.VISIBLE, activity.findViewById<WebView>(R.id.webView).visibility)
                }
                // A local document exercises the new real renderer/production bridge without
                // depending on the remote site's response to the restored navigation request.
                loadLifecycleDocument(scenario, recoveryUrl)
                assertEquals(BuildConfig.VERSION_NAME, evaluateWebViewText(scenario, "window.bridgeVersion"))
                assertTrue(evaluateWebViewText(scenario, "document.cookie")?.contains("$cookieName=preserved") == true)
            }
        } finally {
            setRecoveryCookie("$cookieName=; Max-Age=0; Path=/; SameSite=Lax")
        }
    }

    @Test
    fun backgroundRendererTerminationDefersReplacementUntilTheSameActivityResumes() {
        assumeRendererTerminationSupported()
        grantMandatoryPermissions()
        waitUntil("필수 권한 허용") {
            Settings.canDrawOverlays(context) && isNotificationListenerEnabled()
        }
        withObservedWebViewLifecycle { scenario ->
            loadLifecycleDocument(scenario)
            lateinit var originalActivity: MainActivity
            lateinit var original: LifecycleObservedWebView
            scenario.onActivity { activity ->
                originalActivity = activity
                original = activity.findViewById(R.id.webView)
            }
            scenario.moveToState(Lifecycle.State.CREATED)

            terminateRenderer(original)
            waitUntil("배경 renderer 종료 후 손상된 WebView 해제", 10_000) {
                var released = false
                InstrumentationRegistry.getInstrumentation().runOnMainSync {
                    released = original.destroyCalls == 1
                }
                released
            }
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                assertFalse(originalActivity.isFinishing)
                assertFalse(originalActivity.isDestroyed)
                assertNull(original.parent)
                assertNull(originalActivity.findViewById<WebView>(R.id.webView))
            }
            assertEquals(Lifecycle.State.CREATED, scenario.state)

            scenario.moveToState(Lifecycle.State.RESUMED)
            waitUntil("전경 복귀 시 WebView 복구", 10_000) {
                var restored = false
                scenario.onActivity { activity ->
                    assertSame(originalActivity, activity)
                    val replacement = activity.findViewById<WebView>(R.id.webView)
                    restored = replacement != null && replacement !== original && replacement.visibility == View.VISIBLE
                }
                restored
            }
            loadLifecycleDocument(scenario)
            assertEquals(BuildConfig.VERSION_NAME, evaluateWebViewText(scenario, "window.bridgeVersion"))
        }
    }

    @Test
    fun repeatedRendererTerminationAutomaticallyRestoresTheSameActivityWithoutUserAction() {
        assumeRendererTerminationSupported()
        grantMandatoryPermissions()
        waitUntil("필수 권한 허용") {
            Settings.canDrawOverlays(context) && isNotificationListenerEnabled()
        }
        withObservedWebViewLifecycle { scenario ->
            loadLifecycleDocument(scenario)
            lateinit var originalActivity: MainActivity
            lateinit var original: WebView
            scenario.onActivity { activity ->
                originalActivity = activity
                original = activity.findViewById(R.id.webView)
            }
            terminateRenderer(original)
            lateinit var recovered: WebView
            waitUntil("첫 renderer 종료의 자동 복구", 10_000) {
                var restored = false
                scenario.onActivity { activity ->
                    val replacement = activity.findViewById<WebView>(R.id.webView)
                    if (replacement != null && replacement !== original) {
                        recovered = replacement
                        restored = true
                    }
                }
                restored
            }
            loadLifecycleDocument(scenario)

            terminateRenderer(recovered)
            // Recovery must continue without any click, Activity recreation, or resume action.
            waitUntil("연속 renderer 종료 후 사용자 조작 없이 자동 복구", 10_000) {
                var restored = false
                scenario.onActivity { activity ->
                    assertSame(originalActivity, activity)
                    assertFalse(activity.isFinishing)
                    val replacement = activity.findViewById<WebView>(R.id.webView)
                    restored = replacement != null && replacement !== recovered &&
                        replacement !== original && replacement.visibility == View.VISIBLE
                }
                restored
            }
            scenario.onActivity { assertNull(recovered.parent) }
            loadLifecycleDocument(scenario)
            assertEquals(BuildConfig.VERSION_NAME, evaluateWebViewText(scenario, "window.bridgeVersion"))
        }
    }

    private fun assumeRendererTerminationSupported() {
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.GET_WEB_VIEW_RENDERER))
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_TERMINATE))
    }

    /** Trigger the actual renderer process exit; never call the production callback ourselves. */
    private fun terminateRenderer(webView: WebView) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val renderer = WebViewCompat.getWebViewRenderProcess(webView)
            assertTrue("Loaded WebView must have a separate renderer", renderer != null)
            assertTrue("Actual WebView renderer termination must be accepted", renderer!!.terminate())
        }
    }

    private fun setRecoveryCookie(cookie: String) {
        val finished = CountDownLatch(1)
        val accepted = AtomicBoolean(false)
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            CookieManager.getInstance().setCookie("${TrustedWebOrigin.APP_ORIGIN}/", cookie) {
                accepted.set(it)
                finished.countDown()
            }
        }
        assertTrue("Test cookie write timed out", finished.await(3, TimeUnit.SECONDS))
        assertTrue("Test cookie write must succeed", accepted.get())
        CookieManager.getInstance().flush()
    }

    private fun loadLifecycleDocument(
        scenario: ActivityScenario<MainActivity>,
        url: String = "${TrustedWebOrigin.APP_ORIGIN}/native-test/lifecycle"
    ) {
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.webView).loadDataWithBaseURL(
                url,
                """<!doctype html><html><body>Lifecycle document<script>
                    window.resumeEvents = 0;
                    window.addEventListener('household-account:android-resume', function() { window.resumeEvents++; });
                    window.bridgeVersion = null;
                    HouseholdNativeBridge.onmessage = function(event) {
                      window.bridgeVersion = JSON.parse(event.data).result.value.version;
                    };
                    HouseholdNativeBridge.postMessage(JSON.stringify({contractVersion:'android-bridge.v1',
                      requestId:'lifecycle-version',operation:'app.get-version',payload:{}}));
                </script></body></html>""".trimIndent(),
                "text/html", "UTF-8", url
            )
        }
        waitUntil("실제 WebView 문서와 Native bridge 준비") {
            evaluateWebViewText(scenario, "document.readyState === 'complete' && window.bridgeVersion") == BuildConfig.VERSION_NAME
        }
    }

    private fun withObservedWebViewLifecycle(block: (ActivityScenario<MainActivity>) -> Unit) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val monitor = ActivityLifecycleMonitorRegistry.getInstance()
        val callback = ActivityLifecycleCallback { activity, stage ->
            if (activity is MainActivity && stage == Stage.PRE_ON_CREATE) {
                activity.layoutInflater.factory2 = object : LayoutInflater.Factory2 {
                    override fun onCreateView(parent: View?, name: String, context: Context, attrs: AttributeSet): View? =
                        if (name == "WebView" || name == WebView::class.java.name) {
                            LifecycleObservedWebView(context, attrs)
                        } else {
                            activity.delegate.createView(parent, name, context, attrs)
                        }

                    override fun onCreateView(name: String, context: Context, attrs: AttributeSet): View? =
                        onCreateView(null, name, context, attrs)
                }
            }
        }
        instrumentation.runOnMainSync { monitor.addLifecycleCallback(callback) }
        try {
            ActivityScenario.launch(MainActivity::class.java).use(block)
        } finally {
            instrumentation.runOnMainSync { monitor.removeLifecycleCallback(callback) }
        }
    }

    /** Observe the real WebView teardown; never replace its renderer or destruction behavior. */
    private class LifecycleObservedWebView(context: Context, attrs: AttributeSet) : WebView(context, attrs) {
        var destroyCalls = 0
            private set
        var wasDetachedAtDestroy = false
            private set

        override fun destroy() {
            wasDetachedAtDestroy = parent == null
            super.destroy()
            destroyCalls++
        }
    }

    @Test
    fun realWebViewBridgeIsOriginBoundAndHistoryBackKeepsTheActivityOpen() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            // Local HTML uses the real production WebView and message listener, without fetching a site.
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.webView).loadDataWithBaseURL(
                    "${TrustedWebOrigin.APP_ORIGIN}/native-test/start",
                    """<!doctype html><html><body><input id="draft" value="keep-draft">
                        <button style="position:fixed;inset:0;width:100%;height:100%" onclick="history.pushState({}, '', '/native-test/second')">다음 화면</button><script>
                        window.bridgeResult = null;
                        HouseholdNativeBridge.onmessage = function(event) { window.bridgeResult = JSON.parse(event.data); };
                        HouseholdNativeBridge.postMessage(JSON.stringify({contractVersion:'android-bridge.v1',
                          requestId:'real-webview',operation:'app.get-version',payload:{}}));
                    </script></body></html>""".trimIndent(),
                    "text/html", "UTF-8", "${TrustedWebOrigin.APP_ORIGIN}/native-test/start"
                )
            }
            waitUntil("실제 WebView에서 Native bridge 응답") {
                evaluateWebView(scenario, "window.bridgeResult && window.bridgeResult.result.value.version") ==
                    JSONObject.quote(BuildConfig.VERSION_NAME)
            }
            grantMandatoryPermissions()
            scenario.onActivity { activity ->
                activity.findViewById<Button>(R.id.btnCheckPermission).performClick()
            }
            onView(withId(R.id.webView)).perform(click())
            waitUntil("실제 WebView history 생성") {
                evaluateWebView(scenario, "location.pathname") == "\"/native-test/second\""
            }
            waitUntil("사용자 입력으로 생성된 WebView history 반영") {
                var canGoBack = false
                scenario.onActivity { activity -> canGoBack = activity.findViewById<WebView>(R.id.webView).canGoBack() }
                canGoBack
            }
            scenario.onActivity { activity ->
                assertTrue(activity.findViewById<WebView>(R.id.webView).canGoBack())
                @Suppress("DEPRECATION")
                activity.onBackPressed()
                assertFalse(activity.isFinishing)
            }
            waitUntil("Activity 뒤로가기가 Web history로 이동") {
                evaluateWebView(scenario, "location.pathname") == "\"/native-test/start\""
            }
            assertEquals("\"keep-draft\"", evaluateWebView(scenario, "document.getElementById('draft').value"))

            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.webView).loadDataWithBaseURL(
                    "https://untrusted-native-test.invalid/", "<html><body>untrusted</body></html>",
                    "text/html", "UTF-8", null
                )
            }
            waitUntil("허용하지 않은 origin에는 Native bridge가 노출되지 않음") {
                evaluateWebView(scenario, "location.origin") == "\"https://untrusted-native-test.invalid\"" &&
                    evaluateWebView(scenario, "typeof HouseholdNativeBridge") == "\"undefined\""
            }
        }
    }

    @Test
    fun permissionRechecksAndActivityRecreationRetainTheCurrentTrustedNavigation() {
        val initialUrl = "${TrustedWebOrigin.APP_ORIGIN}/native-test/restore"
        val secondUrl = "$initialUrl#second"
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val webView = activity.findViewById<WebView>(R.id.webView)
                val productionClient = webView.webViewClient
                webView.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                        productionClient.shouldOverrideUrlLoading(view, request)

                    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                        if (request?.url?.toString()?.substringBefore('#') == initialUrl) {
                            val html = """<html><body><button style="position:fixed;inset:0;width:100%;height:100%"
                              onclick="history.pushState({}, '', '#second')">다음 화면</button></body></html>"""
                            return WebResourceResponse("text/html", "UTF-8", html.byteInputStream())
                        }
                        return productionClient.shouldInterceptRequest(view, request)
                    }
                }
                // Only the document network response is supplied; the production navigation callback stays intact.
                webView.loadUrl(initialUrl)
            }
            waitUntil("로컬 trusted HTML 로드") {
                evaluateWebViewText(scenario, "location.href") == initialUrl
            }
            grantMandatoryPermissions()
            scenario.onActivity { activity ->
                activity.findViewById<Button>(R.id.btnCheckPermission).performClick()
            }
            onView(withId(R.id.webView)).perform(click())
            waitUntil("다음 navigation 생성") {
                evaluateWebViewText(scenario, "location.href") == secondUrl
            }
            waitUntil("Native WebView URL 반영") {
                var currentUrl: String? = null
                scenario.onActivity { activity -> currentUrl = activity.findViewById<WebView>(R.id.webView).url }
                currentUrl == secondUrl
            }
            scenario.onActivity { activity ->
                repeat(3) { activity.findViewById<Button>(R.id.btnCheckPermission).performClick() }
                assertEquals(secondUrl, activity.findViewById<WebView>(R.id.webView).url)
            }
            scenario.recreate()
            waitUntil("Activity 재생성 후 WebView navigation 복원") {
                var restoredUrl: String? = null
                scenario.onActivity { activity -> restoredUrl = activity.findViewById<WebView>(R.id.webView).url }
                restoredUrl == secondUrl
            }
            scenario.onActivity { activity ->
                assertTrue(activity.findViewById<WebView>(R.id.webView).canGoBack())
                assertEquals(View.GONE, activity.findViewById<LinearLayout>(R.id.permissionLayout).visibility)
            }
        }
    }

    @Test
    fun permissionGuideBackUsesTheActivityDefaultInsteadOfHiddenWebHistory() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(View.VISIBLE, activity.findViewById<LinearLayout>(R.id.permissionLayout).visibility)
                @Suppress("DEPRECATION")
                activity.onBackPressed()
            }
            waitUntil("권한 안내에서 Activity 기본 뒤로가기") { scenario.state == Lifecycle.State.DESTROYED }
        }
    }

    private fun evaluateWebView(scenario: ActivityScenario<MainActivity>, expression: String): String? {
        val result = AtomicReference<String?>()
        val finished = CountDownLatch(1)
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.webView).evaluateJavascript(expression) {
                result.set(it)
                finished.countDown()
            }
        }
        assertTrue("WebView JavaScript evaluation timed out", finished.await(3, TimeUnit.SECONDS))
        return result.get()
    }

    private fun evaluateWebViewText(scenario: ActivityScenario<MainActivity>, expression: String): String? =
        evaluateWebView(scenario, expression)?.let { JSONTokener(it).nextValue() as? String }

    @Test
    fun actualBridgeCodecReturnsPackageVersionAndRejectsInvalidWireRequests() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val bridge = AndroidHostBridge(activity, consumeAppLaunchDurationMillis = { null })
                fun call(raw: String) = runBlocking { JSONObject(bridge.handle(raw)) }
                val versionRequest = JSONObject()
                    .put("contractVersion", "android-bridge.v1")
                    .put("requestId", "native-wire-version")
                    .put("operation", "app.get-version")
                    .put("payload", JSONObject())
                val response = call(versionRequest.toString())
                assertEquals("android-bridge-response.v1", response.getString("contractVersion"))
                assertEquals("native-wire-version", response.getString("requestId"))
                assertEquals("succeeded", response.getJSONObject("result").getString("kind"))
                assertEquals(BuildConfig.VERSION_NAME,
                    response.getJSONObject("result").getJSONObject("value").getString("version"))

                val malformed = call("{not-json")
                assertEquals("INVALID_JSON", malformed.getJSONObject("result")
                    .getJSONObject("error").getString("code"))
                val unsupported = call(versionRequest.put("contractVersion", "bridge.v1").toString())
                assertEquals("INVALID_CONTRACT", unsupported.getJSONObject("result")
                    .getJSONObject("error").getString("code"))
                val unknown = call(versionRequest.put("contractVersion", "android-bridge.v1")
                    .put("operation", "unknown-operation").toString())
                assertEquals("UNKNOWN_OPERATION", unknown.getJSONObject("result")
                    .getJSONObject("error").getString("code"))
            }
        }
    }

    @Test
    fun bridgeOverlayPreferencePersistsForExactActorAndRejectsAnotherHousehold() = runBlocking {
        HouseholdPreferences.replaceAuthenticatedSession(context, "bridge-house", "member-a", "가구원")
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { activity ->
                    val bridge = AndroidHostBridge(activity, consumeAppLaunchDurationMillis = { null })
                    fun call(operation: String, household: String, member: String, enabled: Boolean? = null): JSONObject {
                        val payload = JSONObject().put("householdId", household).put("memberId", member)
                        enabled?.let { payload.put("enabled", it) }
                        val request = JSONObject().put("contractVersion", "android-bridge.v1")
                            .put("requestId", "overlay-wire").put("operation", operation).put("payload", payload)
                        return runBlocking { JSONObject(bridge.handle(request.toString())).getJSONObject("result") }
                    }
                    val saved = call("quick-edit.set-overlay-enabled", "bridge-house", "member-a", false)
                    assertEquals("succeeded", saved.getString("kind"))
                    assertFalse(HouseholdPreferences.isQuickEditOverlayEnabled(context, "bridge-house", "member-a"))
                    assertFalse(call("quick-edit.get-overlay-enabled", "bridge-house", "member-a")
                        .getJSONObject("value").getBoolean("enabled"))

                    val rejected = call("quick-edit.set-overlay-enabled", "another-house", "member-a", false)
                    assertEquals("rejected", rejected.getString("kind"))
                    assertEquals("SESSION_SCOPE_MISMATCH", rejected.getJSONObject("error").getString("code"))
                    assertTrue(HouseholdPreferences.isQuickEditOverlayEnabled(context, "another-house", "member-a"))
                }
                scenario.recreate()
                assertFalse(HouseholdPreferences.isQuickEditOverlayEnabled(context, "bridge-house", "member-a"))
            }
            HouseholdPreferences.replaceAuthenticatedSession(context, "bridge-house", "member-b", "가구원")
            assertTrue(HouseholdPreferences.isQuickEditOverlayEnabled(context, "bridge-house", "member-b"))
            assertFalse(HouseholdPreferences.isQuickEditOverlayEnabled(context, "bridge-house", "member-a"))
        } finally {
            HouseholdPreferences.clearHouseholdKey(context)
            context.getSharedPreferences("household_prefs", Context.MODE_PRIVATE).edit().clear().commit()
        }
    }

    @Test
    fun bridgeMetadataSkipsNativeAuthInitializationAndEachAuthOperationRequestsIt() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                var authInitializations = 0
                val stopBeforeAuthentication = IllegalStateException("test-auth-initialization")
                val bridge = AndroidHostBridge(
                    context = activity,
                    createAuthCoordinator = {
                        authInitializations += 1
                        throw stopBeforeAuthentication
                    },
                    consumeAppLaunchDurationMillis = { 42L }
                )
                fun request(operation: String) = JSONObject()
                    .put("contractVersion", AndroidHostBridge.REQUEST_VERSION)
                    .put("requestId", operation)
                    .put("operation", operation)
                    .put("payload", JSONObject())
                    .toString()

                runBlocking {
                    assertEquals(0, authInitializations)
                    assertEquals("succeeded", JSONObject(bridge.handle(request("app.get-version")))
                        .getJSONObject("result").getString("kind"))
                    assertEquals(42L, JSONObject(bridge.handle(request("performance.get-app-launch-duration")))
                        .getJSONObject("result").getJSONObject("value").getLong("durationMs"))
                    assertEquals(0, authInitializations)
                    // Stop at construction so this check never opens login UI or calls Firebase.
                    listOf("auth.sign-in", "auth.sign-out", "session.refresh").forEachIndexed { index, operation ->
                        assertSame(stopBeforeAuthentication, runCatching { bridge.handle(request(operation)) }.exceptionOrNull())
                        assertEquals(index + 1, authInitializations)
                    }
                }
            }
        }
    }

    private fun grantMandatoryPermissions() {
        executeShellCommand(
            "appops set ${context.packageName} SYSTEM_ALERT_WINDOW allow"
        )
        executeShellCommand(
            "cmd notification allow_listener ${notificationListener.flattenToString()}"
        )
        waitUntil("시스템 권한 적용") {
            Settings.canDrawOverlays(context) && isNotificationListenerEnabled()
        }
    }

    private fun revokeMandatoryPermissions() {
        executeShellCommand(
            "cmd notification disallow_listener ${notificationListener.flattenToString()}"
        )
        executeShellCommand(
            "appops set ${context.packageName} SYSTEM_ALERT_WINDOW deny"
        )
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners"
        )
        return NotificationListenerAccess.isEnabled(enabled, notificationListener)
    }

    private fun executeShellCommand(command: String) {
        val descriptor: ParcelFileDescriptor =
            InstrumentationRegistry.getInstrumentation()
                .uiAutomation
                .executeShellCommand(command)
        descriptor.use {
            FileInputStream(it.fileDescriptor).use(FileInputStream::readBytes)
        }
    }

    private fun waitUntil(
        description: String,
        timeoutMillis: Long = 5_000,
        condition: () -> Boolean
    ) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(50)
        }
        assertTrue("$description 상태가 제한 시간 안에 확인되지 않았습니다.", condition())
    }
}
