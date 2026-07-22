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
            originalCategoryId = "FOOD",
            originalMemo = "메모",
            merchant = "가맹점",
            amountInWon = 10_000,
            categoryId = "food",
            memo = "메모"
        )

        assertTrue(patch.isEmpty())
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
