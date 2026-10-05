package com.household.account.quickedit

import com.household.account.ledger.LedgerTransactionSnapshot

data class QuickEditDraft(
    val merchant: String,
    val amountInWon: Int,
    val categoryId: String,
    val memo: String,
    val tags: List<String>
)

fun buildQuickEditUpdatePatch(
    original: LedgerTransactionSnapshot,
    draft: QuickEditDraft
): Map<String, Any?> = buildMap {
    if (draft.merchant != original.merchant) put("merchant", draft.merchant)
    if (draft.amountInWon != original.amountInWon) put("amountInWon", draft.amountInWon)
    if (draft.categoryId != original.categoryId) put("categoryId", draft.categoryId)
    // 빈 문자열과 배열도 기존 메모·태그를 지우는 명시적 변경입니다.
    if (draft.memo != original.memo) put("memo", draft.memo)
    if (draft.tags != original.tags) put("tags", draft.tags)
}
