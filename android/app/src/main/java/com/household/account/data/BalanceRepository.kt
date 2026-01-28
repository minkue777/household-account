package com.household.account.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.tasks.await

/**
 * 지역화폐 잔액 저장소
 *
 * Firebase 구조:
 * households/{householdId}/balances/localCurrency
 *   - balance: 784694 (원)
 *   - currencyType: "경기지역화폐"
 *   - updatedAt: Timestamp
 */
class BalanceRepository {
    private val db = FirebaseFirestore.getInstance()

    /**
     * 지역화폐 잔액 저장
     */
    suspend fun saveLocalCurrencyBalance(
        householdId: String,
        balance: Int,
        currencyType: String
    ) {
        val docRef = db.collection("households")
            .document(householdId)
            .collection("balances")
            .document("localCurrency")

        val data = mapOf(
            "balance" to balance,
            "currencyType" to currencyType,
            "updatedAt" to Timestamp.now()
        )

        docRef.set(data, SetOptions.merge()).await()
    }

    /**
     * 지역화폐 잔액 조회
     */
    suspend fun getLocalCurrencyBalance(householdId: String): LocalCurrencyBalance? {
        val docRef = db.collection("households")
            .document(householdId)
            .collection("balances")
            .document("localCurrency")

        val snapshot = docRef.get().await()
        if (!snapshot.exists()) return null

        val data = snapshot.data ?: return null
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
