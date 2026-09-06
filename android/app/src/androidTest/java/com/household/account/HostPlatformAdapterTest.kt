package com.household.account

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.household.account.service.NotificationMessageExtractor
import com.household.account.service.FcmService
import com.household.account.notifications.FcmServiceComponentGate
import com.household.account.session.AndroidSessionMirrorStore
import com.household.account.session.SessionMirrorSnapshot
import com.household.account.session.SessionMirrorState
import com.household.account.webhost.NotificationListenerAccess
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HostPlatformAdapterTest {
    @Test fun logoutGateDisablesTheActualFcmServiceAndRegistrationCanReenableIt() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val component = ComponentName(context, FcmService::class.java)
        val manager = context.packageManager
        val original = manager.getComponentEnabledSetting(component)
        try {
            assertTrue(FcmServiceComponentGate.enableForRegistration(context))
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                manager.getComponentEnabledSetting(component))
            assertTrue(FcmServiceComponentGate.disableForLogout(context))
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                manager.getComponentEnabledSetting(component))
            // 재시작·중복 로그아웃에서도 이미 닫힌 component를 다시 열지 않습니다.
            assertTrue(FcmServiceComponentGate.disableForLogout(context))
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                manager.getComponentEnabledSetting(component))
        } finally {
            manager.setComponentEnabledSetting(component, original, PackageManager.DONT_KILL_APP)
        }
    }

    @Test fun listenerPermissionRequiresTheExactServiceComponent() {
        val expected = ComponentName("com.household.account", "com.household.account.service.CardNotificationListenerService")
        assertFalse(NotificationListenerAccess.isEnabled("com.household.account.fake/.Listener", expected))
        assertFalse(NotificationListenerAccess.isEnabled("com.household.account/.AnotherListener", expected))
        assertTrue(NotificationListenerAccess.isEnabled("unrelated/.Listener:" + expected.flattenToShortString(), expected))
    }

    @Suppress("DEPRECATION")
    @Test fun frameworkMessagingStyleIsExtractedThroughTheApi26CompatibleAdapter() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val notification = Notification.Builder(context, "adapter-test")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setStyle(Notification.MessagingStyle("self").addMessage("structured payment", 1234L, "sender"))
            .build()
        val messages = NotificationMessageExtractor.extract(notification)
        assertEquals(1, messages.size)
        assertEquals("structured payment", messages.single().text)
        assertEquals(1234L, messages.single().postedAtMillis)
    }

    @Test fun sessionMirrorPersistsAnEncryptedAtomicSnapshot() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val preferences = context.getSharedPreferences("native_session_mirror.v1", Context.MODE_PRIVATE)
        val previous = preferences.getString("ciphertext", null)
        try {
            val expected = SessionMirrorState(generation = 3, snapshot = SessionMirrorSnapshot(
                "private-household-sentinel", "member-stable", "private-name-sentinel", 3, updatedAtEpochMillis = 10))
            AndroidSessionMirrorStore(context).replace(expected)
            assertEquals(expected, AndroidSessionMirrorStore(context).load())
            val persisted = preferences.all.toString()
            assertFalse(persisted.contains("private-household-sentinel"))
            assertFalse(persisted.contains("private-name-sentinel"))
            assertEquals(setOf("ciphertext"), preferences.all.keys)
        } finally {
            val editor = preferences.edit().clear()
            if (previous != null) editor.putString("ciphertext", previous)
            check(editor.commit())
        }
    }
}
