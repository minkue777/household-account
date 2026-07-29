package com.household.account.startup

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
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

    @Test
    fun `앱 실행 시간은 Activity 생성부터 단조 시계로 한 번 이어서 잰다`() {
        var now = 1_000L
        val clock = AppLaunchDurationClock { now }

        now = 1_275L
        assertEquals(275L, clock.consumeElapsedMillis())
        // 같은 Activity 안의 WebView reload는 새 앱 실행 표본이 아닙니다.
        assertEquals(null, clock.consumeElapsedMillis())
    }

    @Test
    fun `비정상 시계 구현에서도 음수 앱 실행 시간을 내보내지 않는다`() {
        var now = 1_000L
        val clock = AppLaunchDurationClock { now }

        now = 900L
        assertEquals(0L, clock.consumeElapsedMillis())
    }
}
