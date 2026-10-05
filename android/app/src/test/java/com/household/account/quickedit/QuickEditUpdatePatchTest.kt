package com.household.account.quickedit

import com.household.account.ledger.LedgerTransactionSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickEditUpdatePatchTest {
    private val original = LedgerTransactionSnapshot("transaction", 3, "active", "expense", 10_000, "2026-10-05", "10:00", "가맹점", "food", "메모", listOf("여행"))
    private fun draft(snapshot: LedgerTransactionSnapshot = original) = QuickEditDraft(snapshot.merchant, snapshot.amountInWon, snapshot.categoryId, snapshot.memo, snapshot.tags)

    @Test fun `태그만 추가하면 태그 변경만 전송한다`() {
        val tags = listOf("여행", "민규용돈")
        assertEquals(mapOf("tags" to tags), buildQuickEditUpdatePatch(original, draft().copy(tags = tags)))
    }

    @Test fun `태그를 모두 지우면 명시적인 빈 배열을 전송한다`() {
        assertEquals(mapOf("tags" to emptyList<String>()), buildQuickEditUpdatePatch(original, draft().copy(tags = emptyList())))
    }

    @Test fun `변경하지 않은 기존 태그는 한도를 넘어도 전송하지 않는다`() {
        val snapshot = original.copy(tags = (1..11).map { "태그$it" })
        assertTrue(buildQuickEditUpdatePatch(snapshot, draft(snapshot)).isEmpty())
    }

    @Test fun `변경하지 않은 필드는 patch에서 제외한다`() {
        assertTrue(buildQuickEditUpdatePatch(original, draft()).isEmpty())
    }

    @Test fun `사용자 카테고리의 메모만 수정하면 ID는 patch에서 제외한다`() {
        val snapshot = original.copy(categoryId = "category-aBcD_123", memo = "")
        assertEquals(mapOf("memo" to "메모 추가"), buildQuickEditUpdatePatch(snapshot, draft(snapshot).copy(memo = "메모 추가")))
    }

    @Test fun `대소문자가 다른 카테고리 ID로 바꾸면 변경을 전송한다`() {
        val snapshot = original.copy(categoryId = "category-aBcD_123")
        assertEquals(mapOf("categoryId" to "category-abcd_123"), buildQuickEditUpdatePatch(snapshot, draft(snapshot).copy(categoryId = "category-abcd_123")))
    }

    @Test fun `빈 memo 변경과 실제 변경 필드만 명시하고 원본 snapshot은 유지한다`() {
        assertEquals(mapOf("amountInWon" to 12000, "categoryId" to "living", "memo" to ""), buildQuickEditUpdatePatch(original, draft().copy(amountInWon = 12000, categoryId = "living", memo = "")))
        assertEquals(3, original.aggregateVersion)
        assertEquals(10000, original.amountInWon)
        assertEquals("메모", original.memo)
    }
}
