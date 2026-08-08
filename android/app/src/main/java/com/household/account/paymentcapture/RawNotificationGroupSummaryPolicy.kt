package com.household.account.paymentcapture

/** 카카오 누적 대화의 group summary만 제외하고 기존 공급자 알림 동작은 유지합니다. */
object RawNotificationGroupSummaryPolicy {
    fun shouldSkip(
        source: RegisteredNotificationSource?,
        isGroupSummary: Boolean
    ): Boolean =
        isGroupSummary && source == RegisteredNotificationSource.KAKAO_TALK_FINANCIAL
}
