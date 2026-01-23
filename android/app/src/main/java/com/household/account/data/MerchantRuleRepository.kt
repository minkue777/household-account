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
     * 모든 규칙 조회 (실시간)
     */
    fun getAllRules(): Flow<List<MerchantRule>> = callbackFlow {
        val listenerRegistration = rulesCollection
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
     * 가맹점명으로 카테고리 찾기
     */
    suspend fun findCategoryForMerchant(merchantName: String): Category? {
        return try {
            val snapshot = rulesCollection.get().await()
            val rules = snapshot.documents.mapNotNull { doc ->
                doc.toObject(MerchantRule::class.java)?.copy(id = doc.id)
            }

            // 정확히 일치하는 규칙 먼저 찾기
            val exactMatch = rules.find { rule ->
                rule.exactMatch && rule.merchantKeyword.equals(merchantName, ignoreCase = true)
            }
            if (exactMatch != null) {
                return exactMatch.getCategoryEnum()
            }

            // 부분 일치 규칙 찾기
            val partialMatch = rules.find { rule ->
                !rule.exactMatch && merchantName.contains(rule.merchantKeyword, ignoreCase = true)
            }
            partialMatch?.getCategoryEnum()

        } catch (e: Exception) {
            Log.e(TAG, "findCategoryForMerchant failed", e)
            null
        }
    }

    /**
     * 같은 키워드 규칙이 있는지 확인
     */
    suspend fun ruleExists(keyword: String): Boolean {
        return try {
            val snapshot = rulesCollection
                .whereEqualTo("merchantKeyword", keyword)
                .get()
                .await()
            !snapshot.isEmpty
        } catch (e: Exception) {
            Log.e(TAG, "ruleExists check failed", e)
            false
        }
    }
}
