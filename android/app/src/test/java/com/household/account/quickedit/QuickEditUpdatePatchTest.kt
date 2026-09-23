package com.household.account.quickedit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickEditUpdatePatchTest {
    @Test
    fun `태그만 추가하면 태그 변경만 전송한다`() {
        assertEquals(mapOf("tags" to listOf("여행", "민규용돈")), tagPatch(listOf("여행"), listOf("여행", "민규용돈")))
    }

    @Test
    fun `태그를 모두 지우면 명시적인 빈 배열을 전송한다`() {
        assertEquals(mapOf("tags" to emptyList<String>()), tagPatch(listOf("여행"), emptyList()))
    }

    @Test
    fun `변경하지 않은 기존 태그는 한도를 넘어도 전송하지 않는다`() {
        val tags = (1..11).map { "태그$it" }
        assertTrue(tagPatch(tags, tags).isEmpty())
    }

    private fun tagPatch(originalTags: List<String>, tags: List<String>) = buildQuickEditUpdatePatch(
        originalMerchant = "가맹점", originalAmountInWon = 10_000,
        originalCategoryId = "food", originalMemo = "메모",
        merchant = "가맹점", amountInWon = 10_000, categoryId = "food", memo = "메모",
        originalTags = originalTags, tags = tags
    )

    @Test
    fun `변경하지 않은 필드는 patch에서 제외한다`() {
        val patch = buildQuickEditUpdatePatch(
            originalMerchant = "가맹점",
            originalAmountInWon = 10_000,
            originalCategoryId = "food",
            originalMemo = "메모",
            merchant = "가맹점",
            amountInWon = 10_000,
            categoryId = "food",
            memo = "메모"
        )

        assertTrue(patch.isEmpty())
    }

    @Test
    fun `사용자 카테고리의 메모만 수정하면 ID는 patch에서 제외한다`() {
        val patch = buildQuickEditUpdatePatch(
            originalMerchant = "가맹점",
            originalAmountInWon = 10_000,
            originalCategoryId = "category-aBcD_123",
            originalMemo = "",
            merchant = "가맹점",
            amountInWon = 10_000,
            categoryId = "category-aBcD_123",
            memo = "메모 추가"
        )

        assertEquals(mapOf("memo" to "메모 추가"), patch)
    }

    @Test
    fun `대소문자가 다른 카테고리 ID로 바꾸면 변경을 전송한다`() {
        val patch = buildQuickEditUpdatePatch(
            originalMerchant = "가맹점",
            originalAmountInWon = 10_000,
            originalCategoryId = "category-aBcD_123",
            originalMemo = "",
            merchant = "가맹점",
            amountInWon = 10_000,
            categoryId = "category-abcd_123",
            memo = ""
        )

        assertEquals(mapOf("categoryId" to "category-abcd_123"), patch)
    }

    @Test
    fun `빈 memo 변경과 실제 변경 필드만 명시한다`() {
        val patch = buildQuickEditUpdatePatch(
            originalMerchant = "가맹점",
            originalAmountInWon = 10_000,
            originalCategoryId = "food",
            originalMemo = "삭제할 메모",
            merchant = "가맹점",
            amountInWon = 12_000,
            categoryId = "living",
            memo = ""
        )

        assertEquals(
            mapOf(
                "amountInWon" to 12_000,
                "categoryId" to "living",
                "memo" to ""
            ),
            patch
        )
    }
}
