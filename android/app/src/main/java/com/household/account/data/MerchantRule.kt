package com.household.account.data

import com.google.firebase.firestore.DocumentId
import com.google.firebase.Timestamp

/**
 * 매칭 타입: 가맹점명을 어떻게 매칭할지 결정
 * 키워드에 쉼표가 있으면 OR 조건으로 처리됨
 */
enum class MatchType {
    exact,      // 정확히 일치
    contains,   // 포함
    startsWith, // 시작
    endsWith;   // 종료

    companion object {
        fun fromString(value: String?): MatchType {
            return try {
                value?.let { valueOf(it) } ?: contains
            } catch (e: Exception) {
                contains
            }
        }
    }
}

/**
 * 규칙이 매칭되면 적용할 값들
 */
data class MerchantRuleMapping(
    val merchant: String? = null,   // 매핑할 가맹점명
    val category: String? = null,   // 매핑할 카테고리
    val memo: String? = null        // 매핑할 메모
) {
    constructor() : this(null, null, null)

    fun toMap(): Map<String, Any?> {
        return mapOf(
            "merchant" to merchant,
            "category" to category,
            "memo" to memo
        ).filterValues { it != null }
    }

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun fromMap(map: Map<String, Any?>?): MerchantRuleMapping {
            if (map == null) return MerchantRuleMapping()
            return MerchantRuleMapping(
                merchant = map["merchant"] as? String,
                category = map["category"] as? String,
                memo = map["memo"] as? String
            )
        }
    }
}

/**
 * 가맹점 → 지출 정보 자동 매핑 규칙
 */
data class MerchantRule(
    @DocumentId
    val id: String = "",
    val householdId: String = "",

    // 매칭 조건
    val merchantKeyword: String = "",       // 매칭할 키워드/패턴
    val matchType: String = MatchType.contains.name,  // 매칭 방식

    // 매핑 결과 (규칙이 매칭되면 이 값들로 대체)
    val mapping: Map<String, Any?>? = null,

    // 메타데이터
    val priority: Int = 0,                  // 우선순위 (높을수록 먼저 적용)
    val isActive: Boolean = true,           // 규칙 활성화 여부
    val createdAt: Timestamp? = null,
    val updatedAt: Timestamp? = null,

    // 하위 호환성을 위한 deprecated 필드
    @Deprecated("Use mapping.category instead")
    val category: String = Category.ETC.name,
    @Deprecated("Use matchType instead")
    val exactMatch: Boolean = false
) {
    constructor() : this("", "", "", MatchType.contains.name, null, 0, true, null, null, Category.ETC.name, false)

    fun getMatchTypeEnum(): MatchType {
        // 하위 호환성: matchType이 없으면 exactMatch로 판단
        return if (matchType.isNotEmpty()) {
            MatchType.fromString(matchType)
        } else {
            if (exactMatch) MatchType.exact else MatchType.contains
        }
    }

    fun getMappingObject(): MerchantRuleMapping {
        // 하위 호환성: mapping이 없으면 category 필드 사용
        return if (mapping != null) {
            MerchantRuleMapping.fromMap(mapping)
        } else {
            MerchantRuleMapping(category = category)
        }
    }

    fun getCategoryEnum(): Category {
        val mapping = getMappingObject()
        val categoryStr = mapping.category ?: category
        return try {
            Category.valueOf(categoryStr.uppercase())
        } catch (e: Exception) {
            Category.ETC
        }
    }

    fun toMap(): Map<String, Any?> {
        return mapOf(
            "householdId" to householdId,
            "merchantKeyword" to merchantKeyword,
            "matchType" to matchType,
            "mapping" to mapping,
            "priority" to priority,
            "isActive" to isActive,
            "createdAt" to createdAt,
            "updatedAt" to updatedAt,
            // 하위 호환성
            "category" to category,
            "exactMatch" to exactMatch
        ).filterValues { it != null }
    }
}

/**
 * 가맹점명에 규칙을 적용한 결과
 */
data class AppliedRuleResult(
    val rule: MerchantRule,
    val mappedMerchant: String,
    val mappedCategory: Category,
    val mappedMemo: String
)
