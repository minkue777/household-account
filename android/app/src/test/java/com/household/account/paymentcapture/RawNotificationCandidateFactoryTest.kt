package com.household.account.paymentcapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RawNotificationCandidateFactoryTest {
    private val first = """
        삼성8481승인 이*규
        198,000원 일시불
        08/08 13:23 신세계사우스시티
        누적198,000원
    """.trimIndent()
    private val second = """
        삼성8481승인 이*규
        4,050원 일시불
        08/08 13:26 신세계사우스시티
        누적202,050원
    """.trimIndent()
    private val third = """
        삼성8481승인 이*규
        78,120원 일시불
        08/08 13:33 신세계사우스시티
        누적280,170원
    """.trimIndent()

    @Test
    fun `MessagingStyle 누적 이력은 메시지별 raw 후보로 분리한다`() {
        val updates = listOf(
            listOf(message(first, 1_000L)),
            listOf(message(first, 1_000L), message(second, 2_000L)),
            listOf(message(first, 1_000L), message(second, 2_000L), message(third, 3_000L))
        )

        val candidatesByUpdate = updates.map { messages ->
            RawNotificationCandidateFactory.create(
                RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                snapshot(structuredMessages = messages)
            )
        }

        assertEquals(listOf(first), candidatesByUpdate[0].map { it.text })
        assertEquals(listOf(first, second), candidatesByUpdate[1].map { it.text })
        assertEquals(listOf(first, second, third), candidatesByUpdate[2].map { it.text })
        assertEquals(listOf(1_000L, 2_000L, 3_000L), candidatesByUpdate[2].map { it.postedAtMillis })
        assertTrue(candidatesByUpdate.flatten().all { it.bigText.isEmpty() && it.textLines.isEmpty() })

        val recentFullTexts = mutableSetOf<String>()
        val newlyObserved = candidatesByUpdate.flatten()
            .filter { recentFullTexts.add(it.fullText) }
        assertEquals(listOf(first, second, third), newlyObserved.map { it.text })
    }

    @Test
    fun `구조화 이력이 없으면 카카오 대화 경계로 블록을 나누고 후보별 admission을 적용한다`() {
        val conversation = listOf(
            "[이민규] [오후 2:48] 오늘 저녁에 만나요",
            "[이민규] [오후 2:48] $first",
            "[이민규] [오후 2:49] $second",
            "[이민규] [오후 2:49] $third"
        ).joinToString("\n")

        val candidates = RawNotificationCandidateFactory.create(
            RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
            snapshot(text = conversation)
        )
        val accepted = candidates.filter { candidate ->
            RawNotificationForwardingPolicy.shouldForward(
                RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                candidate.title,
                candidate.bodyText
            )
        }

        assertEquals(4, candidates.size)
        assertEquals(3, accepted.size)
        assertFalse(accepted.any { it.text.contains("오늘 저녁에 만나요") })
        assertTrue(accepted[0].text.startsWith("[이민규] [오후 2:48] 삼성8481승인"))
        assertTrue(accepted[2].text.contains("78,120원"))
    }

    @Test
    fun `카카오 대화 경계는 보낸이 길이와 오전 오후 시각 형식을 엄격히 검증한다`() {
        val candidates = RawNotificationCandidateFactory.create(
            RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
            snapshot(
                text = listOf(
                    "[이민규] [오전 09:01] $first",
                    "[이민규] [오후 12:59] $second",
                    "[${"가".repeat(81)}] [오후 1:00] $third"
                ).joinToString("\n")
            )
        )

        assertEquals(2, candidates.size)
        assertTrue(candidates[0].text.startsWith("[이민규] [오전 09:01]"))
        assertTrue(candidates[1].text.contains("[${"가".repeat(81)}] [오후 1:00]"))
    }

    @Test
    fun `구조화 이력이 없으면 text 다음 bigText와 textLines 순서로 fallback한다`() {
        val textCandidate = RawNotificationCandidateFactory.create(
            RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
            snapshot(text = first, bigText = third)
        ).single()
        val bigTextCandidate = RawNotificationCandidateFactory.create(
            RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
            snapshot(
                text = "삼성8481승인",
                bigText = first,
                textLines = third.lines()
            )
        ).single()
        val textLinesCandidate = RawNotificationCandidateFactory.create(
            RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
            snapshot(
                text = "삼성8481승인",
                bigText = "삼성8481승인 198,000원",
                textLines = listOf("도시가스요금 청구서", "48,210원")
            )
        ).single()

        assertEquals(first, textCandidate.text)
        assertTrue(textCandidate.bigText.isEmpty())
        assertEquals(first, bigTextCandidate.bigText)
        assertTrue(bigTextCandidate.text.isEmpty())
        assertEquals(listOf("도시가스요금 청구서", "48,210원"), textLinesCandidate.textLines)
    }

    @Test
    fun `title은 카카오 field tier admission 증거가 아니다`() {
        val candidates = RawNotificationCandidateFactory.create(
            RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
            snapshot(
                text = "오늘 저녁에 만나요",
                bigText = "내일 다시 연락할게요"
            ).copy(title = first)
        )

        assertTrue(candidates.isEmpty())
    }

    private fun snapshot(
        text: String = "",
        bigText: String = "",
        textLines: List<String> = emptyList(),
        structuredMessages: List<StructuredNotificationMessage> = emptyList()
    ) = RawNotificationSnapshot(
        postedAtMillis = 9_000L,
        title = "이민규",
        text = text,
        bigText = bigText,
        textLines = textLines,
        structuredMessages = structuredMessages
    )

    private fun message(text: String, postedAtMillis: Long) =
        StructuredNotificationMessage(text, postedAtMillis)
}
