package com.household.account.data

import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * Firebase Firestore를 통한 지출 데이터 관리
 */
class ExpenseRepository {

    private val firestore = FirebaseFirestore.getInstance()
    private val expensesCollection = firestore.collection("expenses")

    companion object {
        private const val TAG = "ExpenseRepository"
    }

    /**
     * 지출 추가
     */
    suspend fun addExpense(expense: Expense): String {
        return try {
            val docRef = expensesCollection.add(expense.toMap()).await()
            docRef.id
        } catch (e: Exception) {
            Log.e(TAG, "addExpense failed", e)
            ""
        }
    }

    /**
     * 지출 수정
     */
    suspend fun updateExpense(expense: Expense) {
        try {
            if (expense.id.isNotEmpty()) {
                expensesCollection.document(expense.id).set(expense.toMap()).await()
            }
        } catch (e: Exception) {
            Log.e(TAG, "updateExpense failed", e)
        }
    }

    /**
     * 지출 삭제
     */
    suspend fun deleteExpense(expenseId: String) {
        try {
            expensesCollection.document(expenseId).delete().await()
        } catch (e: Exception) {
            Log.e(TAG, "deleteExpense failed", e)
        }
    }

    /**
     * 특정 월의 지출 목록 조회 (실시간) - 단순화된 쿼리
     */
    fun getExpensesByMonth(year: Int, month: Int): Flow<List<Expense>> = callbackFlow {
        val startDate = String.format("%04d-%02d-01", year, month)
        val endDate = String.format("%04d-%02d-31", year, month)

        // 단순화된 쿼리 (인덱스 불필요)
        val listenerRegistration = expensesCollection
            .orderBy("date", Query.Direction.DESCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Firestore listen failed", error)
                    trySend(emptyList())
                    return@addSnapshotListener
                }

                val expenses = snapshot?.documents?.mapNotNull { doc ->
                    try {
                        doc.toObject(Expense::class.java)?.copy(id = doc.id)
                    } catch (e: Exception) {
                        Log.e(TAG, "Document parse error", e)
                        null
                    }
                }?.filter { expense ->
                    // 클라이언트 측에서 날짜 필터링
                    expense.date >= startDate && expense.date <= endDate
                } ?: emptyList()

                trySend(expenses)
            }

        awaitClose {
            listenerRegistration.remove()
        }
    }

    /**
     * 특정 날짜의 지출 목록 조회 (실시간)
     */
    fun getExpensesByDate(date: String): Flow<List<Expense>> = callbackFlow {
        val listenerRegistration = expensesCollection
            .whereEqualTo("date", date)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Firestore listen failed", error)
                    trySend(emptyList())
                    return@addSnapshotListener
                }

                val expenses = snapshot?.documents?.mapNotNull { doc ->
                    try {
                        doc.toObject(Expense::class.java)?.copy(id = doc.id)
                    } catch (e: Exception) {
                        null
                    }
                } ?: emptyList()

                trySend(expenses)
            }

        awaitClose {
            listenerRegistration.remove()
        }
    }

    /**
     * 모든 지출 조회 (일회성)
     */
    suspend fun getAllExpenses(): List<Expense> {
        return try {
            val snapshot = expensesCollection
                .orderBy("date", Query.Direction.DESCENDING)
                .get()
                .await()

            snapshot.documents.mapNotNull { doc ->
                doc.toObject(Expense::class.java)?.copy(id = doc.id)
            }
        } catch (e: Exception) {
            Log.e(TAG, "getAllExpenses failed", e)
            emptyList()
        }
    }

    /**
     * 카테고리 업데이트
     */
    suspend fun updateCategory(expenseId: String, category: Category) {
        try {
            expensesCollection.document(expenseId)
                .update("category", category.name)
                .await()
        } catch (e: Exception) {
            Log.e(TAG, "updateCategory failed", e)
        }
    }

    /**
     * 카테고리와 메모 업데이트
     */
    suspend fun updateExpenseFields(expenseId: String, category: String, memo: String) {
        try {
            val updates = mutableMapOf<String, Any>(
                "category" to category
            )
            if (memo.isNotEmpty()) {
                updates["memo"] = memo
            }
            expensesCollection.document(expenseId)
                .update(updates)
                .await()
        } catch (e: Exception) {
            Log.e(TAG, "updateExpenseFields failed", e)
        }
    }

    /**
     * 지출 항목 전체 필드 업데이트 (가맹점, 금액, 카테고리, 메모, 알림 여부)
     */
    suspend fun updateExpenseAllFields(
        expenseId: String,
        merchant: String? = null,
        amount: Int? = null,
        category: String? = null,
        memo: String? = null,
        notifyPartner: Boolean = false
    ) {
        try {
            val updates = mutableMapOf<String, Any>()
            merchant?.let { updates["merchant"] = it }
            amount?.let { updates["amount"] = it }
            category?.let { updates["category"] = it }
            memo?.let { updates["memo"] = it }
            updates["notifyPartner"] = notifyPartner

            if (updates.isNotEmpty()) {
                expensesCollection.document(expenseId)
                    .update(updates)
                    .await()
            }
        } catch (e: Exception) {
            Log.e(TAG, "updateExpenseAllFields failed", e)
        }
    }

    /**
     * 지출 분할 (원본 삭제 후 여러 개 생성)
     */
    suspend fun splitExpense(originalExpenseId: String, splits: List<Expense>): List<String> {
        return try {
            // 원본 삭제
            deleteExpense(originalExpenseId)

            // 분할된 항목들 추가
            splits.map { expense ->
                addExpense(expense)
            }
        } catch (e: Exception) {
            Log.e(TAG, "splitExpense failed", e)
            emptyList()
        }
    }
}
