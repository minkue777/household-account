package com.household.account.notifications

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FidLogoutDetachmentTest {
    @Test
    fun `원격 삭제가 느려도 로컬 FCM 해제를 동시에 시작한다`() = runTest {
        val remoteStarted = CompletableDeferred<Unit>()
        val finishRemote = CompletableDeferred<Unit>()
        var localUnregistered = false
        val cleared = mutableListOf<String>()
        val events = mutableListOf<String>()

        val result = async {
            detachFidForLogout(
                fid = "fid-1",
                timeoutMillis = 10_000L,
                disableLocalDelivery = {
                    events += "component-disabled"
                    true
                },
                persistLocalSuppression = { events += "suppression-persisted" },
                removeRemoteEndpoint = {
                    events += "remote-started"
                    remoteStarted.complete(Unit)
                    finishRemote.await()
                    true
                },
                unregisterLocalInstallation = {
                    events += "local-unregister-started"
                    localUnregistered = true
                },
                clearLocalBindingIfCurrent = cleared::add
            )
        }

        remoteStarted.await()
        assertTrue(localUnregistered)
        finishRemote.complete(Unit)

        assertEquals(
            FidLogoutDetachmentResult(
                FidLogoutDetachmentStatus.SUCCEEDED,
                FidLogoutDetachmentStatus.SUCCEEDED,
                FidLogoutDetachmentStatus.SUCCEEDED,
                FidLogoutDetachmentStatus.SUCCEEDED
            ),
            result.await()
        )
        assertEquals(listOf("fid-1", "fid-1"), cleared)
        assertEquals("component-disabled", events.first())
        assertTrue(
            events.indexOf("suppression-persisted") < events.indexOf("remote-started")
        )
        assertTrue(events.contains("remote-started"))
        assertTrue(events.contains("local-unregister-started"))
    }

    @Test
    fun `원격과 로컬 해제 실패는 로그아웃 orchestration을 throw하지 않고 상태로 끝낸다`() = runTest {
        var cleared = false

        val result = detachFidForLogout(
            fid = "fid-1",
            timeoutMillis = 10_000L,
            disableLocalDelivery = { true },
            persistLocalSuppression = {},
            removeRemoteEndpoint = { error("server unavailable") },
            unregisterLocalInstallation = { error("FCM unavailable") },
            clearLocalBindingIfCurrent = { cleared = true }
        )

        assertEquals(FidLogoutDetachmentStatus.FAILED, result.remoteRemoval)
        assertEquals(FidLogoutDetachmentStatus.FAILED, result.localUnregistration)
        assertEquals(FidLogoutDetachmentStatus.SUCCEEDED, result.localDeliveryGate)
        assertFalse(cleared)
    }

    @Test
    fun `원격과 로컬 해제는 각각 timeout으로 종료되어 로그아웃을 무기한 막지 않는다`() = runTest {
        val result = detachFidForLogout(
            fid = "fid-1",
            timeoutMillis = 1L,
            disableLocalDelivery = { true },
            persistLocalSuppression = {},
            removeRemoteEndpoint = { awaitCancellation() },
            unregisterLocalInstallation = { awaitCancellation() },
            clearLocalBindingIfCurrent = {}
        )

        assertEquals(FidLogoutDetachmentStatus.TIMED_OUT, result.remoteRemoval)
        assertEquals(FidLogoutDetachmentStatus.TIMED_OUT, result.localUnregistration)
    }

    @Test
    fun `component disable 실패도 원격과 로컬 정리 시도를 막지 않는다`() = runTest {
        var remoteAttempted = false
        var localAttempted = false

        val result = detachFidForLogout(
            fid = "fid-1",
            timeoutMillis = 10_000L,
            disableLocalDelivery = { false },
            persistLocalSuppression = {},
            removeRemoteEndpoint = {
                remoteAttempted = true
                true
            },
            unregisterLocalInstallation = { localAttempted = true },
            clearLocalBindingIfCurrent = {}
        )

        assertEquals(FidLogoutDetachmentStatus.FAILED, result.localDeliveryGate)
        assertTrue(remoteAttempted)
        assertTrue(localAttempted)
    }

    @Test
    fun `suppression 저장 실패 전에 component를 차단하고 나머지 detach를 계속 시도한다`() = runTest {
        val events = mutableListOf<String>()

        val result = detachFidForLogout(
            fid = "fid-1",
            timeoutMillis = 10_000L,
            disableLocalDelivery = {
                events += "component-disabled"
                true
            },
            persistLocalSuppression = {
                events += "suppression-attempted"
                error("preference commit failed")
            },
            removeRemoteEndpoint = {
                events += "remote-attempted"
                true
            },
            unregisterLocalInstallation = { events += "local-attempted" },
            clearLocalBindingIfCurrent = {}
        )

        assertEquals(FidLogoutDetachmentStatus.SUCCEEDED, result.localDeliveryGate)
        assertEquals(FidLogoutDetachmentStatus.FAILED, result.localSuppression)
        assertEquals(FidLogoutDetachmentStatus.SUCCEEDED, result.remoteRemoval)
        assertEquals(FidLogoutDetachmentStatus.SUCCEEDED, result.localUnregistration)
        assertEquals("component-disabled", events.first())
        assertTrue(events.contains("remote-attempted"))
        assertTrue(events.contains("local-attempted"))
    }

    @Test
    fun `현재 session에 확인된 binding만 foreground 알림을 표시한다`() {
        val binding = FidNotificationBinding("household-1", "member-1", 3)

        assertTrue(
            canDisplayFidNotification(
                "household-1",
                "member-1",
                suppressedForLogout = false,
                binding = binding
            )
        )
        assertFalse(canDisplayFidNotification("", "", false, binding))
        assertFalse(canDisplayFidNotification("household-1", "member-2", false, binding))
        assertFalse(canDisplayFidNotification("household-1", "member-1", true, binding))
        assertFalse(canDisplayFidNotification("household-1", "member-1", false, null))
    }

    @Test
    fun `재로그인은 stale 설치를 해제한 뒤 component를 열고 register한다`() = runTest {
        val events = mutableListOf<String>()

        val result = startFidRegistration(
            staleCleanupRequired = true,
            timeoutMillis = 10_000L,
            unregisterStaleInstallation = { events += "stale-unregistered" },
            enableLocalDelivery = {
                events += "component-enabled"
                true
            },
            registerInstallation = { events += "register-started" },
            disableAfterFailure = { events += "component-disabled" }
        )

        assertEquals(FidRegistrationStartStatus.STARTED, result)
        assertEquals(
            listOf("stale-unregistered", "component-enabled", "register-started"),
            events
        )
    }

    @Test
    fun `stale 해제나 register가 실패하면 수신 component를 fail-closed로 유지한다`() = runTest {
        var enabled = false
        var disabledAfterStaleFailure = false
        val staleFailure = startFidRegistration(
            staleCleanupRequired = true,
            timeoutMillis = 10_000L,
            unregisterStaleInstallation = { error("network") },
            enableLocalDelivery = {
                enabled = true
                true
            },
            registerInstallation = {},
            disableAfterFailure = { disabledAfterStaleFailure = true }
        )
        assertEquals(
            FidRegistrationStartStatus.STALE_UNREGISTRATION_FAILED,
            staleFailure
        )
        assertFalse(enabled)
        assertTrue(disabledAfterStaleFailure)

        var disabledAgain = false
        val registerFailure = startFidRegistration(
            staleCleanupRequired = false,
            timeoutMillis = 10_000L,
            unregisterStaleInstallation = {},
            enableLocalDelivery = { true },
            registerInstallation = { error("register failed") },
            disableAfterFailure = { disabledAgain = true }
        )
        assertEquals(FidRegistrationStartStatus.REGISTRATION_FAILED, registerFailure)
        assertTrue(disabledAgain)
    }
}
