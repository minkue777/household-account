package com.household.account.startup

import android.os.SystemClock
import kotlin.math.max

/**
 * Activity 인스턴스가 만들어진 시점부터의 경과 시간을 단조 시계로 측정합니다.
 *
 * 벽시계 변경의 영향을 받지 않으며, Web 화면이 첫 콘텐츠 표시를 알릴 때까지
 * Native WebView 준비 시간까지 포함한 실제 앱 시작 시간을 제공합니다.
 */
internal class AppLaunchDurationClock(
    private val elapsedRealtimeMillis: () -> Long = SystemClock::elapsedRealtime
) {
    private val startedAtMillis = elapsedRealtimeMillis()
    private var consumed = false

    @Synchronized
    fun consumeElapsedMillis(): Long? {
        if (consumed) return null
        consumed = true
        return max(0L, elapsedRealtimeMillis() - startedAtMillis)
    }
}
