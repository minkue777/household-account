package com.household.account

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ApplicationInfo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.household.account.service.NotificationMessageExtractor
import com.household.account.service.FcmService
import com.household.account.service.CardNotificationListenerService
import com.household.account.notifications.FcmServiceComponentGate
import com.household.account.session.AndroidSessionMirrorStore
import com.household.account.session.SessionMirrorSnapshot
import com.household.account.session.SessionMirrorState
import com.household.account.webhost.NotificationListenerAccess
import com.household.account.paymentcapture.AndroidKeystoreCaptureQueueStore
import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.paymentcapture.QueuedCapture
import com.household.account.paymentcapture.RawNotificationEnvelopeV1
import org.xmlpull.v1.XmlPullParser
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HostPlatformAdapterTest {
    @Test fun actualListenerDedupUsesInclusiveThirtySecondWindowWithoutExtendingIt() {
        val service = CardNotificationListenerService()
        val remember = CardNotificationListenerService::class.java.getDeclaredMethod(
            "rememberRecentKey", MutableMap::class.java, String::class.java,
            Long::class.javaPrimitiveType, Long::class.javaPrimitiveType
        ).apply { isAccessible = true }
        fun duplicate(entries: MutableMap<String, Long>, key: String, now: Long) =
            remember.invoke(service, entries, key, now, 30_000L) as Boolean
        for (elapsed in listOf(29_999L, 30_000L, 30_001L)) {
            val entries = mutableMapOf<String, Long>()
            assertFalse(duplicate(entries, "package_body", 100_000L))
            assertEquals("Actual Listener boundary at ${elapsed}ms", elapsed <= 30_000L,
                duplicate(entries, "package_body", 100_000L + elapsed))
        }
        val entries = mutableMapOf<String, Long>()
        assertFalse(duplicate(entries, "package_body", 100_000L))
        assertTrue(duplicate(entries, "package_body", 129_999L))
        assertEquals(100_000L, entries["package_body"])
        assertFalse(duplicate(entries, "package_body", 130_001L))
        assertFalse(duplicate(entries, "other-package_body", 130_001L))
        assertFalse(duplicate(mutableMapOf(), "package_body", 130_002L))
    }

    @Test fun installedBackupPolicyExcludesEveryPrivateStorageDomain() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertEquals(0, context.applicationInfo.flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
        val expectedDomains = setOf("root", "file", "database", "sharedpref", "external")
        val expectedSections = mapOf(
            R.xml.backup_rules to setOf("full-backup-content"),
            R.xml.data_extraction_rules to setOf("cloud-backup", "device-transfer")
        )
        expectedSections.forEach { (resourceId, sections) ->
            val actual = mutableMapOf<String, MutableSet<String>>()
            context.resources.getXml(resourceId).use { parser ->
                var section: String? = null
                while (parser.eventType != XmlPullParser.END_DOCUMENT) {
                    if (parser.eventType == XmlPullParser.START_TAG) {
                        if (parser.name in sections) section = parser.name
                        assertFalse("Private storage must not be opted into backup", parser.name == "include")
                        if (parser.name == "exclude") {
                            assertEquals(".", parser.getAttributeValue(null, "path"))
                            actual.getOrPut(checkNotNull(section)) { mutableSetOf() }
                                .add(parser.getAttributeValue(null, "domain"))
                        }
                    }
                    parser.next()
                }
            }
            assertEquals(sections, actual.keys)
            actual.forEach { (_, domains) -> assertEquals(expectedDomains, domains) }
        }
    }

    @Test fun captureJournalReloadRunsTheActualKotlinCodecAndKeystoreWithoutPlaintext() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = AndroidKeystoreCaptureQueueStore(context)
        val preferences = context.getSharedPreferences("capture_delivery_queue.v1", Context.MODE_PRIVATE)
        try {
            store.clear()
            val envelope = RawNotificationEnvelopeV1.create(
                packageName = "com.kbcard.cxh.appcard",
                postedAtMillis = 1_783_000_000_000L,
                title = "private-title-sentinel",
                text = "private-payment-sentinel", bigText = "", textLines = emptyList(),
                observationId = "observation.android.keystore-journal-test"
            )
            val entry = QueuedCapture(CaptureSessionScope("private-house-sentinel", "member", 3L), envelope, 123L)
            store.replace(listOf(entry))
            val persisted = preferences.all.toString()
            assertFalse(persisted.contains("private-title-sentinel"))
            assertFalse(persisted.contains("private-payment-sentinel"))
            assertFalse(persisted.contains("private-house-sentinel"))
            assertEquals(setOf("ciphertext"), preferences.all.keys)
            assertEquals(listOf(entry), AndroidKeystoreCaptureQueueStore(context).load())
        } finally {
            store.clear()
        }
    }

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
