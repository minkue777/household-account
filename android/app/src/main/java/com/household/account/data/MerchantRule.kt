package com.household.account.data

import com.google.firebase.firestore.DocumentId

/**
 * 가맹점 → 카테고리 자동 분류 규칙
 */
data class MerchantRule(
    @DocumentId
    val id: String = "",
    val merchantKeyword: String = "",  // 가맹점명 키워드 (부분 일치)
    val category: String = Category.ETC.name,
    val exactMatch: Boolean = false    // true: 정확히 일치, false: 포함 여부
) {
    constructor() : this("", "", Category.ETC.name, false)

    fun toMap(): Map<String, Any> {
        return mapOf(
            "merchantKeyword" to merchantKeyword,
            "category" to category,
            "exactMatch" to exactMatch
        )
    }

    fun getCategoryEnum(): Category {
        return try {
            Category.valueOf(category)
        } catch (e: Exception) {
            Category.ETC
        }
    }
}
