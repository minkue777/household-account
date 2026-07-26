package com.household.account.startup

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivityStartupGatesTest {
    @Test
    fun `onCreate 직후 첫 resume만 중복 화면 갱신을 건너뛴다`() {
        val gate = FirstResumeRefreshGate()

        assertFalse(gate.shouldRefreshContent())
        assertTrue(gate.shouldRefreshContent())
        assertTrue(gate.shouldRefreshContent())
    }

    @Test
    fun `WebView 최초 로드와 캡처 재시도 예약은 Activity마다 한 번만 허용한다`() {
        val gate = OneShotExecutionGate()

        assertTrue(gate.tryEnter())
        assertFalse(gate.tryEnter())
        assertFalse(gate.tryEnter())
    }
}
