package com.household.account.paymentcapture

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RawNotificationForwardingPolicyTest {
    @Test
    fun `문자 앱은 지원 금융 후보만 서버로 보낸다`() {
        assertTrue(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.SMS,
                "문자 메시지",
                "[Web발신] 삼성1876승인 20,300원"
            )
        )
        assertFalse(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.SMS,
                "친구",
                "오늘 저녁에 만나요"
            )
        )
        assertTrue(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.SMS,
                "페이북",
                "국민행복카드(신용)농협(4321) 가맹점에서 7,900원 사용"
            )
        )
        assertTrue(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.SMS,
                "문자 메시지",
                "[NH농협카드] 07월분 아파트관리비 182,000원 카드 정상(승인)납부 완료"
            )
        )
        assertFalse(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.SMS,
                "카드 이벤트",
                "카드 고객에게 10,000원 상당 혜택을 드립니다"
            )
        )
    }

    @Test
    fun `카카오톡은 도시가스 청구 후보만 서버로 보낸다`() {
        assertTrue(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.CITY_GAS_BILL,
                "도시가스",
                "도시가스요금 청구서 납부하실 총 금액은 48,210원"
            )
        )
        assertFalse(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.CITY_GAS_BILL,
                "가족",
                "일반 카카오톡 대화"
            )
        )
    }

    @Test
    fun `전용 공급자 앱은 내용 해석 없이 서버 parser로 전달한다`() {
        assertTrue(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.KB,
                "새 형식",
                "서버 parser가 판단할 원문"
            )
        )
    }
}
