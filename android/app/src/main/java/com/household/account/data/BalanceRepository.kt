package com.household.account.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await

/**
 * 지역화폐 잔액 저장소
 *
 * Firebase 구조:
 * balances/{documentId}
 *   - householdId: "xxx"
 *   - type: "localCurrency"
 *   - balance: 784694 (원)
 *   - currencyType: "경기지역화폐"
 *   - updatedAt: Timestamp
 */
class BalanceRepository {
    private val db = FirebaseFirestore.getInstance()
    private val balancesCollection = db.collection("balances")

    /**
     * 지역화폐 잔액 저장 (upsert)
     */
    suspend fun saveLocalCurrencyBalance(
        householdId: String,
        balance: Int,
        currencyType: String
    ) {
        // 기존 문서 찾기
        val existing = balancesCollection
            .whereEqualTo("householdId", householdId)
            .whereEqualTo("type", "localCurrency")
            .get()
            .await()

        val data = mapOf(
            "householdId" to householdId,
            "type" to "localCurrency",
            "balance" to balance,
            "currencyType" to currencyType,
            "updatedAt" to Timestamp.now()
        )

        if (existing.isEmpty) {
            // 새로 생성
            balancesCollection.add(data).await()
        } else {
            // 기존 문서 업데이트
            existing.documents.first().reference.set(data).await()
        }
    }

    /**
     * 지역화폐 잔액 조회
     */
    suspend fun getLocalCurrencyBalance(householdId: String): LocalCurrencyBalance? {
        val snapshot = balancesCollection
            .whereEqualTo("householdId", householdId)
            .whereEqualTo("type", "localCurrency")
            .get()
            .await()

        if (snapshot.isEmpty) return null

        val data = snapshot.documents.first().data ?: return null
        return LocalCurrencyBalance(
            balance = (data["balance"] as? Long)?.toInt() ?: 0,
            currencyType = data["currencyType"] as? String ?: "지역화폐",
            updatedAt = data["updatedAt"] as? Timestamp
        )
    }
}

data class LocalCurrencyBalance(
    val balance: Int,
    val currencyType: String,
    val updatedAt: Timestamp?
)
