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
        assertTrue(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.SMS,
                "문자 메시지",
                """
                    [Web발신]
                    NH카드4*3*승인
                    김*휘
                    5,760원 일시불
                    07/30 19:09
                    진로마트 행신점
                    총누적1,431,944원
                """.trimIndent()
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
    fun `카카오톡은 엄격한 카드 거래와 도시가스 후보만 서버로 보낸다`() {
        assertTrue(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                "이민규",
                """
                    삼성8481승인 이*규
                    198,000원 일시불
                    08/08 13:23 신세계사우스시티
                    누적198,000원
                """.trimIndent()
            )
        )
        assertTrue(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                "도시가스",
                "도시가스요금 청구서 납부하실 총 금액은 48,210원"
            )
        )
        assertTrue(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                "이민규",
                "삼성8481승인취소 198,000원 08/08 14:01 신세계사우스시티"
            )
        )
        listOf("할인마트", "혜택상점").forEach { merchant ->
            assertTrue(
                merchant,
                RawNotificationForwardingPolicy.shouldForward(
                    RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                    "이민규",
                    "삼성8481승인 198,000원 08/08 13:23 $merchant"
                )
            )
        }
        listOf(
            "오늘 저녁에 만나요",
            "신세계에서 쓴 돈은 198,000원이야",
            "삼성카드 승인 고객께 10,000원 혜택, 08/08까지",
            "삼성카드 승인됐고 198,000원이야. 08/08 13:23 만나자",
            "삼성카드 8481 승인 이벤트 10,000원 혜택 08/08 13:23 신청 마감",
            "삼성카드 8481을 쓰며 승인 이야기를 했다 198,000원 08/08 13:23",
            "[광고] 삼성8481승인 198,000원 08/08 13:23 할인마트",
            "이벤트 안내 삼성8481승인 198,000원 08/08 13:23 혜택상점",
            "삼성8481승인 198,000원 신세계사우스시티"
        ).forEach { message ->
            assertFalse(
                message,
                RawNotificationForwardingPolicy.shouldForward(
                    RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                    "가족",
                    message
                )
            )
        }
        assertFalse(
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                "삼성8481승인 198,000원 08/08 13:23 신세계사우스시티",
                "오늘 저녁에 만나요"
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
