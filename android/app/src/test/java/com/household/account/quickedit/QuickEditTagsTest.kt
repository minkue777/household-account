package com.household.account.quickedit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickEditTagsTest {
    @Test
    fun `입력중 태그까지 앞쪽 해시와 공백을 정리하고 중복만 제거한다`() {
        val result = validateQuickEditTags(listOf(" #2026부산여행 ", "##2026부산여행", "", "#", " 가족 여행,행사#1 ", "Trip", "trip"))

        assertEquals(
            QuickEditTagsValidation.Valid(listOf("2026부산여행", "가족 여행,행사#1", "Trip", "trip")),
            result
        )
        assertEquals(listOf("여행"), normalizeQuickEditTags(listOf("\uFEFF#여행\u00A0")))
    }

    @Test
    fun `태그 열 개와 유니코드 문자 서른 개까지 허용한다`() {
        assertTrue(validateQuickEditTags((1..10).map { "태그$it" }) is QuickEditTagsValidation.Valid)
        assertTrue(validateQuickEditTags(listOf("🧳".repeat(30))) is QuickEditTagsValidation.Valid)
        assertTrue(validateQuickEditTags(listOf("한".repeat(30))) is QuickEditTagsValidation.Valid)
        assertEquals(
            QuickEditTagsValidation.Invalid("태그는 30자까지 입력할 수 있습니다"),
            validateQuickEditTags(listOf("🧳".repeat(31)))
        )
        assertEquals(
            QuickEditTagsValidation.Invalid("태그는 최대 10개까지 추가할 수 있습니다"),
            validateQuickEditTags((1..11).map { "태그$it" })
        )
    }

    @Test
    fun `중복을 제외한 개수를 검증하고 빈 목록을 전체 제거로 허용한다`() {
        assertEquals(
            QuickEditTagsValidation.Valid(listOf("여행")),
            validateQuickEditTags(List(11) { "여행" })
        )
        assertEquals(QuickEditTagsValidation.Valid(emptyList()), validateQuickEditTags(listOf(" # ", "")))
    }

    @Test
    fun `이전 한도를 넘는 기존 태그는 그대로 보존하고 변경할 때 현재 한도를 검증한다`() {
        val oldTags = (1..11).map { "태그$it" } + "오래된태그".repeat(10)
        assertEquals(QuickEditTagsValidation.Valid(oldTags), validateQuickEditTags(oldTags + "", oldTags))
        assertTrue(validateQuickEditTags(oldTags + "새태그", oldTags) is QuickEditTagsValidation.Invalid)
        assertEquals(QuickEditTagsValidation.Valid(emptyList()), validateQuickEditTags(emptyList(), oldTags))
    }
}
