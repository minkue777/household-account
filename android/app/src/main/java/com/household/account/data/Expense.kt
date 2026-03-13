package com.household.account.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.Exclude

/**
 * 지출 카테고리
 */
enum class Category(val label: String, val color: Long) {
    LIVING("생활비", 0xFF4ADE80),
    CHILDCARE("육아비", 0xFFF472B6),
    FIXED("고정비", 0xFF60A5FA),
    FOOD("식비", 0xFFFBBF24),
    ETC("기타", 0xFF9CA3AF);

    companion object {
        fun fromLabel(label: String): Category {
            return entries.find { it.label == label } ?: ETC
        }
    }
}

/**
 * 카드 타입 (소문자로 저장)
 */
enum class CardType(val label: String, val key: String) {
    MAIN("본인카드", "main"),
    FAMILY("가족카드", "family")
}

/**
 * 지출 데이터 모델
 */
data class Expense(
    @DocumentId
    val id: String = "",
    val date: String = "",           // YYYY-MM-DD
    val time: String = "",           // HH:mm
    val merchant: String = "",       // 가맹점명
    val amount: Int = 0,             // 금액
    val category: String = Category.ETC.name,  // 카테고리
    val cardType: String = CardType.MAIN.key,  // 카드 타입 (소문자: main, family, sam, local_currency)
    val cardLastFour: String = "",   // 카드 끝 4자리
    val memo: String = "",           // 메모
    val householdId: String = "",    // 가구 키
    @get:Exclude val createdAt: Timestamp = Timestamp.now(),  // 역직렬화 제외 (타입 불일치 방지)
) {
    // Firestore 저장을 위한 no-arg constructor
    constructor() : this(
        id = "",
        date = "",
        time = "",
        merchant = "",
        amount = 0,
        category = Category.ETC.name,
        cardType = CardType.MAIN.key,
        cardLastFour = "",
        memo = "",
        householdId = "",
        createdAt = Timestamp.now()
    )

    fun toMap(): Map<String, Any> {
        val map = mutableMapOf<String, Any>(
            "date" to date,
            "time" to time,
            "merchant" to merchant,
            "amount" to amount,
            "category" to category,
            "cardType" to cardType,
            "cardLastFour" to cardLastFour,
            "memo" to memo,
            "createdAt" to createdAt
        )
        if (householdId.isNotEmpty()) {
            map["householdId"] = householdId
        }
        return map
    }

    fun getCategoryEnum(): Category {
        return try {
            Category.valueOf(category)
        } catch (e: Exception) {
            Category.ETC
        }
    }

    fun getCardTypeEnum(): CardType {
        return try {
            // 소문자 key로 매칭 시도
            CardType.entries.find { it.key == cardType.lowercase() }
                ?: CardType.valueOf(cardType.uppercase())  // 대문자 enum name으로 시도
        } catch (e: Exception) {
            CardType.MAIN
        }
    }
}
