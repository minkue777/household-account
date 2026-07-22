package com.household.account.quickedit

fun buildQuickEditUpdatePatch(
    originalMerchant: String,
    originalAmountInWon: Int,
    originalCategoryId: String,
    originalMemo: String,
    merchant: String,
    amountInWon: Int,
    categoryId: String,
    memo: String
): Map<String, Any?> = buildMap {
    if (merchant != originalMerchant) put("merchant", merchant)
    if (amountInWon != originalAmountInWon) put("amountInWon", amountInWon)
    if (!categoryId.equals(originalCategoryId, ignoreCase = true)) {
        put("categoryId", categoryId)
    }
    // 빈 문자열도 기존 memo를 지우는 명시적 변경 값입니다.
    if (memo != originalMemo) put("memo", memo)
}
