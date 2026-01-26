package com.household.account.data

import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * 가맹점 분류 규칙 관리
 */
class MerchantRuleRepository {

    private val firestore = FirebaseFirestore.getInstance()
    private val rulesCollection = firestore.collection("merchant_rules")

    companion object {
        private const val TAG = "MerchantRuleRepository"

        /**
         * 매칭 타입별 우선순위 (높을수록 먼저 적용)
         */
        private val MATCH_TYPE_PRIORITY = mapOf(
            MatchType.exact to 4,
            MatchType.startsWith to 3,
            MatchType.endsWith to 2,
            MatchType.contains to 1
        )
    }

    /**
     * 가맹점명이 규칙과 매칭되는지 확인
     * 키워드에 쉼표가 있으면 OR 조건으로 처리
     */
    private fun matchesMerchant(
        merchantName: String,
        keyword: String,
        matchType: MatchType
    ): Boolean {
        val normalizedMerchant = merchantName.lowercase().trim()

        // 쉼표가 있으면 OR 조건으로 처리
        val keywords = keyword.split(",").map { it.trim().lowercase() }.filter { it.isNotEmpty() }

        // 각 키워드에 대해 매칭 검사 (하나라도 매칭되면 true)
        return keywords.any { normalizedKeyword ->
            when (matchType) {
                MatchType.exact -> normalizedMerchant == normalizedKeyword
                MatchType.contains -> normalizedMerchant.contains(normalizedKeyword)
                MatchType.startsWith -> normalizedMerchant.startsWith(normalizedKeyword)
                MatchType.endsWith -> normalizedMerchant.endsWith(normalizedKeyword)
            }
        }
    }

    /**
     * 가맹점명에 매칭되는 규칙 찾기
     * 우선순위: priority 높은 순 > exact > startsWith > endsWith > contains
     */
    private fun findMatchingRule(merchantName: String, rules: List<MerchantRule>): MerchantRule? {
        // 활성화된 규칙만 필터링
        val activeRules = rules.filter { it.isActive }

        // 우선순위별로 정렬
        val sortedRules = activeRules.sortedWith(compareBy(
            { -(it.priority) },  // priority 높은 순 (음수로 변환하여 내림차순)
            { -(MATCH_TYPE_PRIORITY[it.getMatchTypeEnum()] ?: 0) }  // matchType 우선순위
        ))

        // 매칭되는 첫 번째 규칙 반환
        return sortedRules.find { rule ->
            matchesMerchant(merchantName, rule.merchantKeyword, rule.getMatchTypeEnum())
        }
    }

    /**
     * 가맹점명에 규칙을 적용하여 매핑된 값 반환
     */
    fun applyRule(merchantName: String, rules: List<MerchantRule>): AppliedRuleResult? {
        val rule = findMatchingRule(merchantName, rules) ?: return null
        val mapping = rule.getMappingObject()

        return AppliedRuleResult(
            rule = rule,
            mappedMerchant = mapping.merchant ?: merchantName,
            mappedCategory = rule.getCategoryEnum(),
            mappedMemo = mapping.memo ?: ""
        )
    }

    /**
     * 규칙 추가
     */
    suspend fun addRule(rule: MerchantRule): String {
        return try {
            val docRef = rulesCollection.add(rule.toMap()).await()
            docRef.id
        } catch (e: Exception) {
            Log.e(TAG, "addRule failed", e)
            ""
        }
    }

    /**
     * 규칙 삭제
     */
    suspend fun deleteRule(ruleId: String) {
        try {
            rulesCollection.document(ruleId).delete().await()
        } catch (e: Exception) {
            Log.e(TAG, "deleteRule failed", e)
        }
    }

    /**
     * 규칙 수정
     */
    suspend fun updateRule(rule: MerchantRule) {
        try {
            if (rule.id.isNotEmpty()) {
                rulesCollection.document(rule.id).set(rule.toMap()).await()
            }
        } catch (e: Exception) {
            Log.e(TAG, "updateRule failed", e)
        }
    }

    /**
     * 모든 규칙 조회 (실시간, householdId 필터링)
     */
    fun getAllRules(householdId: String): Flow<List<MerchantRule>> = callbackFlow {
        if (householdId.isEmpty()) {
            trySend(emptyList())
            awaitClose { }
            return@callbackFlow
        }

        val listenerRegistration = rulesCollection
            .whereEqualTo("householdId", householdId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Firestore listen failed", error)
                    trySend(emptyList())
                    return@addSnapshotListener
                }

                val rules = snapshot?.documents?.mapNotNull { doc ->
                    try {
                        doc.toObject(MerchantRule::class.java)?.copy(id = doc.id)
                    } catch (e: Exception) {
                        Log.e(TAG, "Document parse error", e)
                        null
                    }
                } ?: emptyList()

                trySend(rules)
            }

        awaitClose {
            listenerRegistration.remove()
        }
    }

    /**
     * 가맹점명으로 매핑 결과 찾기 (householdId 필터링)
     * 새 API: 카테고리뿐 아니라 가맹점명, 메모도 매핑
     */
    suspend fun findMappingForMerchant(householdId: String, merchantName: String): AppliedRuleResult? {
        if (householdId.isEmpty()) {
            Log.w(TAG, "householdId is empty, skipping rule lookup")
            return null
        }

        return try {
            val snapshot = rulesCollection
                .whereEqualTo("householdId", householdId)
                .get()
                .await()
            val rules = snapshot.documents.mapNotNull { doc ->
                doc.toObject(MerchantRule::class.java)?.copy(id = doc.id)
            }

            applyRule(merchantName, rules)
        } catch (e: Exception) {
            Log.e(TAG, "findMappingForMerchant failed", e)
            null
        }
    }

    /**
     * 가맹점명으로 카테고리 찾기 (하위 호환성 유지)
     * @deprecated Use findMappingForMerchant instead
     */
    @Deprecated("Use findMappingForMerchant instead", ReplaceWith("findMappingForMerchant(householdId, merchantName)?.mappedCategory"))
    suspend fun findCategoryForMerchant(householdId: String, merchantName: String): Category? {
        return findMappingForMerchant(householdId, merchantName)?.mappedCategory
    }

    /**
     * 같은 키워드/매칭타입 규칙이 있는지 확인
     */
    suspend fun ruleExists(householdId: String, keyword: String, matchType: MatchType? = null): Boolean {
        if (householdId.isEmpty()) return false

        return try {
            var query = rulesCollection
                .whereEqualTo("householdId", householdId)
                .whereEqualTo("merchantKeyword", keyword)

            if (matchType != null) {
                query = query.whereEqualTo("matchType", matchType.name)
            }

            val snapshot = query.get().await()
            !snapshot.isEmpty
        } catch (e: Exception) {
            Log.e(TAG, "ruleExists check failed", e)
            false
        }
    }
}
