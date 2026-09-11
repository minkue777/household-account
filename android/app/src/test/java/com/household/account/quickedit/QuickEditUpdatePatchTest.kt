package com.household.account.quickedit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickEditUpdatePatchTest {
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
