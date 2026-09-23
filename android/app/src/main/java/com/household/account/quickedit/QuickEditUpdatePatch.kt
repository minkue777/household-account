package com.household.account.quickedit

fun buildQuickEditUpdatePatch(
    originalMerchant: String,
    originalAmountInWon: Int,
    originalCategoryId: String,
    originalMemo: String,
    merchant: String,
    amountInWon: Int,
    categoryId: String,
    memo: String,
    originalTags: List<String> = emptyList(),
    tags: List<String> = originalTags
): Map<String, Any?> = buildMap {
    if (merchant != originalMerchant) put("merchant", merchant)
    if (amountInWon != originalAmountInWon) put("amountInWon", amountInWon)
    if (categoryId != originalCategoryId) {
        put("categoryId", categoryId)
    }
    // 빈 문자열도 기존 memo를 지우는 명시적 변경 값입니다.
    if (memo != originalMemo) put("memo", memo)
    // 빈 배열도 기존 태그 전체 제거를 뜻하는 명시적인 변경입니다.
    if (tags != originalTags) put("tags", tags)
}
