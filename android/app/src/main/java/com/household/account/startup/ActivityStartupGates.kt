package com.household.account.startup

/** onCreate 직후 이어지는 첫 onResume에서 같은 화면 판정을 반복하지 않도록 합니다. */
internal class FirstResumeRefreshGate {
    private var firstResumePending = true

    fun shouldRefreshContent(): Boolean {
        if (!firstResumePending) return true
        firstResumePending = false
        return false
    }
}

/** Activity 인스턴스 안에서 최초 시작 작업을 한 번만 실행하도록 합니다. */
internal class OneShotExecutionGate {
    private var entered = false

    fun tryEnter(): Boolean {
        if (entered) return false
        entered = true
        return true
    }
}
