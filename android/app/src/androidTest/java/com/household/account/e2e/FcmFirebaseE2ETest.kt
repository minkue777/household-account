package com.household.account.e2e

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Base64
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.functions.FirebaseFunctions
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.google.firebase.messaging.RemoteMessage
import com.household.account.MainActivity
import com.household.account.notifications.FcmServiceComponentGate
import com.household.account.service.FcmService
import com.household.account.util.FidEndpointManager
import com.household.account.util.HouseholdPreferences
import java.io.File
import java.io.FileInputStream
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** External FCM callback is synthetic; Auth, endpoint Command, service and Android notification UI are real. */
@FirebaseEmulatorE2E
@RunWith(AndroidJUnit4::class)
class FcmFirebaseE2ETest {
    @Test fun registeredCallbackConfirmsServerBindingBeforeForegroundNotificationAndLogoutBlocksIt() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val fixture = JSONObject(String(Base64.decode(checkNotNull(InstrumentationRegistry.getArguments().getString("fixtureBase64")), Base64.DEFAULT), Charsets.UTF_8))
        check(fixture.getString("projectId") == FirebaseEmulatorTestRunner.PROJECT_ID)
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val householdId = fixture.getString("householdId")
        val memberId = fixture.getString("memberId")
        val auth = FirebaseAuth.getInstance()
        val manager = context.getSystemService(NotificationManager::class.java)
        val component = ComponentName(context, FcmService::class.java)
        val originalComponent = context.packageManager.getComponentEnabledSetting(component)
        val originalOverlayPermission = Settings.canDrawOverlays(context)
        val monitor = instrumentation.addMonitor(MainActivity::class.java.name, null, false)
        var opened: MainActivity? = null
        fun shell(command: String) = instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            FileInputStream(descriptor.fileDescriptor).use { it.readBytes().toString(Charsets.UTF_8) }
        }
        suspend fun eventually(description: String, predicate: () -> Boolean) {
            try { withTimeout(30_000) { while (!predicate()) delay(50) } }
            catch (error: kotlinx.coroutines.TimeoutCancellationException) {
                val tree = buildString {
                    fun describe(node: AccessibilityNodeInfo?, depth: Int) {
                        if (node == null) return
                        appendLine("${" ".repeat(depth)}${node.className} text=${node.text} content=${node.contentDescription} clickable=${node.isClickable} visible=${node.isVisibleToUser}")
                        for (index in 0 until node.childCount) describe(node.getChild(index), depth + 1)
                    }
                    describe(instrumentation.uiAutomation.rootInActiveWindow, 0)
                }
                File(context.filesDir, "native-fcm-failure-tree.txt").writeText(tree)
                instrumentation.uiAutomation.takeScreenshot()?.let { screenshot ->
                    File(context.filesDir, "native-fcm-failure.png").outputStream().use {
                        screenshot.compress(Bitmap.CompressFormat.PNG, 100, it)
                    }
                    screenshot.recycle()
                }
                throw AssertionError("$description\n$tree", error)
            }
        }
        try {
            withTimeout(30_000) { auth.signInWithEmailAndPassword(fixture.getString("email"), fixture.getString("password")).await() }
            // Observe the actual SDK failure before background delivery deliberately hides it.
            // This also proves the Native session resolves to the server-created household.
            val ready = withTimeout(30_000) {
                FirebaseFunctions.getInstance(FirebaseAuthenticatedCallableGateway.REGION)
                    .getHttpsCallable("executeHouseholdCommand").call(mapOf(
                        "contractVersion" to "household-command.v1",
                        "commandId" to "native-fcm-session-check",
                        "idempotencyKey" to "native-fcm-session-check",
                        "command" to "access.resolve-signed-in-user.v1",
                        "payload" to emptyMap<String, Any>()
                    )).await().data as Map<*, *>
            }
            val readyResult = ready["result"] as Map<*, *>
            assertEquals("succeeded", readyResult["kind"])
            val readyValue = readyResult["value"] as Map<*, *>
            assertEquals(householdId, (readyValue["membership"] as Map<*, *>)["householdId"])
            HouseholdPreferences.replaceAuthenticatedSession(context, householdId, memberId, "Native FCM E2E")
            if (Build.VERSION.SDK_INT >= 33) {
                shell("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
                eventually("Android notification permission must be granted") { context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED }
            }
            manager.cancelAll()
            eventually("Previous notifications must be cleared") { manager.activeNotifications.isEmpty() }
            val service = FcmService()
            ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java).apply { isAccessible = true }.invoke(service, context)
            val incoming = RemoteMessage(Bundle().apply {
                putString("gcm.n.e", "1")
                putString("gcm.n.title", "FCM 실제 서비스")
                putString("gcm.n.body", "지출을 확인하세요")
            })
            assertNotNull(incoming.notification)
            // A callback observation alone is not trusted. Registration must complete on the server.
            assertFalse(FidEndpointManager.shouldDisplayIncomingNotification(context))
            service.onMessageReceived(incoming)
            assertTrue(manager.activeNotifications.isEmpty())
            assertTrue(FcmServiceComponentGate.enableForRegistration(context))
            service.onRegistered("native-fcm-e2e-installation")
            eventually("Server registration must confirm the current Native FID binding") { FidEndpointManager.shouldDisplayIncomingNotification(context) }

            service.onMessageReceived(RemoteMessage(Bundle().apply { putString("expenseId", "data-only-is-not-a-notification") }))
            assertTrue(manager.activeNotifications.isEmpty())
            service.onMessageReceived(incoming)
            eventually("The real FcmService must post one Android notification") { manager.activeNotifications.size == 1 }
            val notification = manager.activeNotifications.single().notification
            assertEquals("expense_notifications", notification.channelId)
            val channel = manager.getNotificationChannel(notification.channelId)
            assertEquals("지출 알림", channel.name.toString())
            assertEquals(NotificationManager.IMPORTANCE_DEFAULT, channel.importance)
            assertEquals("FCM 실제 서비스", notification.extras.getString(Notification.EXTRA_TITLE))
            assertNotNull(notification.contentIntent)
            assertEquals(context.packageName, notification.contentIntent.creatorPackage)
            // Keep the Activity on its actual permission guide; do not navigate to the production web origin.
            shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW deny")
            eventually("Overlay permission must be disabled before opening MainActivity") { !Settings.canDrawOverlays(context) }
            shell("cmd statusbar expand-notifications")
            eventually("The actual Android notification shade must expose the notification") { instrumentation.uiAutomation.rootInActiveWindow
                ?.findAccessibilityNodeInfosByText("FCM 실제 서비스")?.isNotEmpty() == true }
            var notificationNode: AccessibilityNodeInfo? = instrumentation.uiAutomation.rootInActiveWindow
                ?.findAccessibilityNodeInfosByText("FCM 실제 서비스")?.firstOrNull()
            while (notificationNode != null && !notificationNode.isClickable) notificationNode = notificationNode.parent
            assertTrue("Tap the actual OS notification so Android dispatches its PendingIntent",
                notificationNode?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true)
            opened = instrumentation.waitForMonitorWithTimeout(monitor, 10_000) as? MainActivity
            assertNotNull("The actual notification PendingIntent must launch MainActivity", opened)
            instrumentation.runOnMainSync { opened!!.finish() }
            manager.cancelAll()
            shell("cmd statusbar collapse")
            eventually("The tapped notification must be cleared") { manager.activeNotifications.isEmpty() }

            HouseholdPreferences.replaceAuthenticatedSession(context, householdId, "another-member", "Wrong binding")
            assertFalse(FidEndpointManager.shouldDisplayIncomingNotification(context))
            service.onMessageReceived(incoming)
            assertTrue(manager.activeNotifications.isEmpty())
            HouseholdPreferences.replaceAuthenticatedSession(context, householdId, memberId, "Native FCM E2E")
            assertTrue(FidEndpointManager.shouldDisplayIncomingNotification(context))
            service.onMessageReceived(incoming)
            eventually("Restored member binding must allow one notification") { manager.activeNotifications.size == 1 }
            assertTrue(FcmServiceComponentGate.disableForLogout(context))
            HouseholdPreferences.clearHouseholdKey(context)
            eventually("Logout must clear active notifications") { manager.activeNotifications.isEmpty() }
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED, context.packageManager.getComponentEnabledSetting(component))
            assertFalse(FidEndpointManager.shouldDisplayIncomingNotification(context))
            service.onMessageReceived(incoming)
            assertTrue(manager.activeNotifications.isEmpty())
        } finally {
            instrumentation.removeMonitor(monitor)
            opened?.let { activity -> instrumentation.runOnMainSync { if (!activity.isFinishing) activity.finish() } }
            HouseholdPreferences.clearHouseholdKey(context)
            auth.signOut()
            manager.cancelAll()
            context.getSharedPreferences("fcm_fid_registration_state", Context.MODE_PRIVATE).edit().clear().commit()
            context.packageManager.setComponentEnabledSetting(component, originalComponent, PackageManager.DONT_KILL_APP)
            if (originalOverlayPermission) shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW allow")
        }
    }
}
