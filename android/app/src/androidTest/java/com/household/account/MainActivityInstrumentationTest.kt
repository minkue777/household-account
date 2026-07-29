package com.household.account

import android.content.ComponentName
import android.content.Context
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.Visibility.GONE
import androidx.test.espresso.matcher.ViewMatchers.Visibility.VISIBLE
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withEffectiveVisibility
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.espresso.matcher.ViewMatchers.withText
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
            onView(withId(R.id.permissionLayout)).check(matches(isDisplayed()))
            onView(withId(R.id.permissionLayout))
                .check(matches(withEffectiveVisibility(VISIBLE)))
            onView(withId(R.id.webView))
                .check(matches(withEffectiveVisibility(GONE)))
            onView(withText("알림 접근 권한 설정")).check(matches(isDisplayed()))
            onView(withText("다른 앱 위에 표시 권한 설정")).check(matches(isDisplayed()))

            scenario.onActivity { activity ->
                val webView = activity.findViewById<WebView>(R.id.webView)
                assertEquals(View.GONE, webView.visibility)
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
            onView(withId(R.id.webView)).check(matches(isDisplayed()))
            onView(withId(R.id.permissionLayout))
                .check(matches(withEffectiveVisibility(GONE)))

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
