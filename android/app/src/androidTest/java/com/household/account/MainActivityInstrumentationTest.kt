package com.household.account

import android.content.ComponentName
import android.content.Context
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.LinearLayout
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.household.account.service.CardNotificationListenerService
import com.household.account.webhost.TrustedWebOrigin
import java.io.FileInputStream
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    private fun grantMandatoryPermissions() {
        executeShellCommand(
            "appops set ${context.packageName} SYSTEM_ALERT_WINDOW allow"
        )
        executeShellCommand(
            "cmd notification allow_listener ${notificationListener.flattenToString()}"
        )
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
        return enabled?.contains(notificationListener.flattenToString()) == true ||
            enabled?.contains(context.packageName) == true
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
