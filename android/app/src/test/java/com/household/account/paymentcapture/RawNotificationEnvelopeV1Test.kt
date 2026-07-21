package com.household.account.paymentcapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RawNotificationEnvelopeV1Test {
    @Test
    fun `원문 계약은 parser나 가구 신원을 포함하지 않는다`() {
        val envelope = RawNotificationEnvelopeV1.create(
            packageName = "com.samsung.android.messaging",
            postedAtMillis = 1_774_433_260_000L,
            title = "문자 메시지",
            text = "삼성1876승인",
            bigText = "20,300원 일시불",
            textLines = listOf("07/22 17:40 롯데쇼핑동탄"),
            observationId = "observation.android.fixedraw"
        )

        val wire = envelope.toMap()
        assertEquals("android-raw-notification.v1", wire["contractVersion"])
        assertEquals("com.samsung.android.messaging", wire["packageName"])
        assertFalse(wire.containsKey("parser"))
        assertFalse(wire.containsKey("sourceType"))
        assertFalse(wire.containsKey("householdId"))
        assertFalse(wire.containsKey("createdBy"))
    }

    @Test
    fun `runtime factory는 서버 raw 계약 크기로 원문을 제한하되 parser 우선 본문을 먼저 보존한다`() {
        val envelope = RawNotificationEnvelopeV1.create(
            packageName = "com.samsung.android.messaging",
            postedAtMillis = 1_774_433_260_000L,
            title = "제".repeat(5_000),
            text = "기".repeat(40_000),
            bigText = "확".repeat(70_000),
            textLines = List(40) { "줄".repeat(5_000) },
            observationId = "observation.android.boundedraw"
        )
        val notification = envelope.notification
        val total = notification.title.length + notification.text.length +
            notification.bigText.length + notification.textLines.sumOf { it.length }

        assertEquals(4_096, notification.title.length)
        assertEquals(32, notification.textLines.size)
        assertEquals(65_536, total)
        assertEquals("", notification.bigText)
        assertEquals("", notification.text)
    }

}
