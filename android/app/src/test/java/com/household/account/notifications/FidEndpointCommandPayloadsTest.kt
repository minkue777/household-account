package com.household.account.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class FidEndpointCommandPayloadsTest {
    @Test
    fun `등록 payload는 FID와 기기 정보만 보내고 actor를 보내지 않는다`() {
        val payload = FidEndpointCommandPayloads.registration(
            fid = "fid-1",
            deviceInfo = AndroidEndpointDeviceInfo("Pixel", "16", "36", "2.0.0")
        )

        assertEquals("fid-1", payload["fid"])
        assertEquals("android", payload["platform"])
        assertFalse(payload.containsKey("memberId"))
        assertFalse(payload.containsKey("uid"))
        assertFalse(payload.containsKey("householdId"))
    }

    @Test
    fun `로그아웃 삭제와 SDK 해제 조건부 비활성화를 구분한다`() {
        assertEquals(
            mapOf("fid" to "fid-1", "reason" to "logout"),
            FidEndpointCommandPayloads.logout("fid-1")
        )
        assertEquals(
            mapOf(
                "fid" to "fid-1",
                "reason" to "sdk-unregistered",
                "expectedRegistrationVersion" to 3
            ),
            FidEndpointCommandPayloads.sdkUnregistered("fid-1", 3)
        )
    }
}
