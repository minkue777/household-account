package com.household.account.paymentcapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class RawNotificationObservationIdTest {
    @Test
    fun `같은 날 fallback 누적 A에서 A와 B로 갱신되면 A의 ID와 payload를 유지한다`() {
        val firstBlock = "[이민규] [오후 2:48] ${samsungMessage("198,000", "13:23")}"
        val secondBlock = "[이민규] [오후 2:49] ${samsungMessage("4,050", "13:26")}"
        val firstUpdate = fallbackCandidates(
            Instant.parse("2026-08-08T05:48:10Z").toEpochMilli(),
            firstBlock
        )
        val secondUpdate = fallbackCandidates(
            Instant.parse("2026-08-08T05:49:20Z").toEpochMilli(),
            listOf(firstBlock, secondBlock).joinToString("\n"),
            title = "가변 채팅방 제목 (새 메시지 2개)"
        )

        val firstEnvelope = kakaoEnvelope(firstUpdate.single())
        val repeatedFirstEnvelope = kakaoEnvelope(secondUpdate.first())
        val secondEnvelope = kakaoEnvelope(secondUpdate.last())

        assertEquals(firstEnvelope.observationId, repeatedFirstEnvelope.observationId)
        assertEquals(firstEnvelope.toMap(), repeatedFirstEnvelope.toMap())
        assertEquals(
            "2026-08-08T14:48:00+09:00",
            firstEnvelope.notification.postedAt
        )
        assertNotEquals(firstEnvelope.observationId, secondEnvelope.observationId)
    }

    @Test
    fun `같은 EXTRA_MESSAGES 항목은 알림 게시 시각이 바뀌어도 ID와 raw payload가 같다`() {
        val body = samsungMessage("198,000", "13:23")
        val first = candidate(
            snapshotPostedAtMillis = 10_000L,
            title = "이민규 (새 메시지 3개)",
            messagePostedAtMillis = 1_000L,
            body = body
        )
        val reposted = candidate(
            snapshotPostedAtMillis = 50_001L,
            title = "이민규",
            messagePostedAtMillis = 1_000L,
            body = body
        )

        val firstEnvelope = kakaoEnvelope(first)
        val repostedEnvelope = kakaoEnvelope(reposted)

        assertEquals(firstEnvelope.observationId, repostedEnvelope.observationId)
        assertEquals(firstEnvelope.toMap(), repostedEnvelope.toMap())
        assertEquals("", firstEnvelope.notification.title)
        assertEquals(body, firstEnvelope.notification.text)
        assertTrue(
            firstEnvelope.observationId.matches(
                Regex("""^observation\.android\.kakao\.v1\.[a-f0-9]{64}$""")
            )
        )
    }

    @Test
    fun `카드 후보는 title이 바뀌어도 같은 structured 메시지 ID와 payload를 쓴다`() {
        val body = samsungMessage("198,000", "13:23")
        val first = candidate(10_000L, "이민규", 1_000L, body)
        val changedTitle = candidate(
            50_001L,
            "이민규 (새 메시지 3개)",
            1_000L,
            body
        )

        val firstEnvelope = kakaoEnvelope(first)
        val changedTitleEnvelope = kakaoEnvelope(changedTitle)

        assertEquals(firstEnvelope.observationId, changedTitleEnvelope.observationId)
        assertEquals(firstEnvelope.toMap(), changedTitleEnvelope.toMap())
    }

    @Test
    fun `fallback은 같은 게시 시각 title 본문이면 원본 field가 달라도 동일 payload다`() {
        val postedAtMillis = Instant.parse("2026-08-08T05:48:00Z").toEpochMilli()
        val body = samsungMessage("198,000", "13:23")
        val textCandidate = fallbackCandidate(
            snapshotPostedAtMillis = postedAtMillis,
            title = "이민규",
            text = body
        )
        val bigTextCandidate = fallbackCandidate(
            snapshotPostedAtMillis = postedAtMillis,
            title = "이민규",
            bigText = body
        )

        val textEnvelope = kakaoEnvelope(textCandidate)
        val bigTextEnvelope = kakaoEnvelope(bigTextCandidate)

        assertEquals(textEnvelope.observationId, bigTextEnvelope.observationId)
        assertEquals(textEnvelope.toMap(), bigTextEnvelope.toMap())
    }

    @Test
    fun `카카오 raw projection은 도시가스 청구월 title을 보존한다`() {
        val postedAtMillis = Instant.parse("2026-04-08T05:48:00Z").toEpochMilli()
        val candidate = fallbackCandidate(
            snapshotPostedAtMillis = postedAtMillis,
            title = "[2026년 3월 도시가스요금 청구서]",
            text = "도시가스 요금 청구 48,100원"
        )

        assertEquals(
            "[2026년 3월 도시가스요금 청구서]",
            kakaoEnvelope(candidate).notification.title
        )
        assertEquals(
            "2026-04-08T14:48:00+09:00",
            kakaoEnvelope(candidate).notification.postedAt
        )
    }

    @Test
    fun `fallback은 게시 시각이 바뀌면 같은 본문도 새 ID를 쓴다`() {
        val body = samsungMessage("198,000", "13:23")
        val first = fallbackCandidate(10_000L, "이민규", text = body)
        val reposted = fallbackCandidate(50_001L, "이민규", text = body)

        val firstEnvelope = kakaoEnvelope(first)
        val repostedEnvelope = kakaoEnvelope(reposted)

        assertNotEquals(firstEnvelope.observationId, repostedEnvelope.observationId)
        assertNotEquals(firstEnvelope.toMap(), repostedEnvelope.toMap())
    }

    @Test
    fun `fallback은 다음 해의 동일 MM DD 본문과 ID가 충돌하지 않는다`() {
        val body = "[이민규] [오후 2:48] ${samsungMessage("198,000", "13:23")}"
        val first = fallbackCandidate(
            Instant.parse("2026-08-08T05:48:00Z").toEpochMilli(),
            "이민규",
            text = body
        )
        val nextYear = fallbackCandidate(
            Instant.parse("2027-08-08T05:48:00Z").toEpochMilli(),
            "이민규",
            text = body
        )

        assertNotEquals(
            kakaoEnvelope(first).observationId,
            kakaoEnvelope(nextYear).observationId
        )
    }

    @Test
    fun `메시지 시각이나 후보 본문이 다르면 서로 다른 ID다`() {
        val first = candidate(10_000L, "이민규", 1_000L, samsungMessage("198,000", "13:23"))
        val differentBody = candidate(
            10_000L,
            "이민규",
            1_000L,
            samsungMessage("4,050", "13:26")
        )
        val differentMessageTime = candidate(
            10_000L,
            "이민규",
            2_000L,
            samsungMessage("198,000", "13:23")
        )

        val firstId = RawNotificationObservationId.forKakaoCandidate("com.kakao.talk", first)
        assertNotEquals(
            firstId,
            RawNotificationObservationId.forKakaoCandidate("com.kakao.talk", differentBody)
        )
        assertNotEquals(
            firstId,
            RawNotificationObservationId.forKakaoCandidate(
                "com.kakao.talk",
                differentMessageTime
            )
        )
    }

    private fun candidate(
        snapshotPostedAtMillis: Long,
        title: String,
        messagePostedAtMillis: Long,
        body: String
    ): RawNotificationCandidate = RawNotificationCandidateFactory.create(
        RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
        RawNotificationSnapshot(
            postedAtMillis = snapshotPostedAtMillis,
            title = title,
            text = "",
            bigText = "",
            textLines = emptyList(),
            structuredMessages = listOf(
                StructuredNotificationMessage(body, messagePostedAtMillis)
            )
        )
    ).single()

    private fun fallbackCandidates(
        snapshotPostedAtMillis: Long,
        text: String,
        title: String = "가변 채팅방 제목"
    ): List<RawNotificationCandidate> = RawNotificationCandidateFactory.create(
        RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
        RawNotificationSnapshot(
            postedAtMillis = snapshotPostedAtMillis,
            title = title,
            text = text,
            bigText = "",
            textLines = emptyList()
        )
    )

    private fun fallbackCandidate(
        snapshotPostedAtMillis: Long,
        title: String,
        text: String = "",
        bigText: String = "",
        textLines: List<String> = emptyList()
    ): RawNotificationCandidate = RawNotificationCandidateFactory.create(
        RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
        RawNotificationSnapshot(
            postedAtMillis = snapshotPostedAtMillis,
            title = title,
            text = text,
            bigText = bigText,
            textLines = textLines
        )
    ).single()

    private fun kakaoEnvelope(
        candidate: RawNotificationCandidate
    ): RawNotificationEnvelopeV1 = RawNotificationObservationId.createKakaoEnvelope(
        packageName = "com.kakao.talk",
        candidate = candidate
    )

    private fun samsungMessage(amount: String, time: String): String = """
        삼성8481승인 이*규
        ${amount}원 일시불
        08/08 $time 신세계사우스시티
    """.trimIndent()
}
