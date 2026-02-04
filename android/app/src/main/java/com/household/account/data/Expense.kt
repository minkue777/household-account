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
    val settled: Boolean = false,    // 정산 완료 여부
    val settledAt: String = "",      // 정산 완료 시간
    val settlementRequestedAt: String = "",  // 정산 요청 시간 (정산하기 버튼 클릭 시)
    val pendingSettlement: Boolean = false   // 정산 대기 중 (정산하기 버튼 클릭 시 true)
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
        createdAt = Timestamp.now(),
        settled = false,
        settledAt = "",
        settlementRequestedAt = "",
        pendingSettlement = false
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
        // 정산 필요 여부 판단
        if (checkSettleable(cardType, category)) {
            map["settled"] = false
        }
        return map
    }

    /**
     * 정산 필요 여부 판단
     * - 삼성카드(sam) + 생활비(food, childcare, living) → 필요
     * - 삼성카드(sam) + 비상금(etc) → 필요
     * - 국민카드(main/family) + 비상금(etc) → 필요
     * - 그 외 → 불필요
     */
    private fun checkSettleable(cardType: String, category: String): Boolean {
        val card = cardType.lowercase()
        val cat = category.lowercase()
        val livingCategories = listOf("food", "childcare", "living")

        // local_currency는 정산 불필요
        if (card == "local_currency") {
            return false
        }
        // 비상금(etc)은 카드 종류 상관없이 정산 필요 (local_currency 제외)
        if (cat == "etc") {
            return true
        }
        // 삼성카드(sam)는 생활비 카테고리만 정산 필요
        if (card == "sam") {
            return livingCategories.contains(cat)
        }
        // 그 외 (국민카드 main/family 등)는 정산 불필요
        return false
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
