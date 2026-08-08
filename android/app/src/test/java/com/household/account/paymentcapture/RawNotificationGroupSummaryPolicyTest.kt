package com.household.account.paymentcapture

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RawNotificationGroupSummaryPolicyTest {
    @Test
    fun `카카오 group summary만 건너뛴다`() {
        assertTrue(
            RawNotificationGroupSummaryPolicy.shouldSkip(
                RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                isGroupSummary = true
            )
        )
        listOf(
            RegisteredNotificationSource.SMS,
            RegisteredNotificationSource.SAMSUNG,
            RegisteredNotificationSource.TOSS_BANK,
            null
        ).forEach { source ->
            assertFalse(
                RawNotificationGroupSummaryPolicy.shouldSkip(
                    source,
                    isGroupSummary = true
                )
            )
        }
        assertFalse(
            RawNotificationGroupSummaryPolicy.shouldSkip(
                RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                isGroupSummary = false
            )
        )
    }
}
