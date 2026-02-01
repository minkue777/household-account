package com.household.account.data

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

    /**
     * 지출 추가
     */
    suspend fun addExpense(expense: Expense): String {
        return try {
            val docRef = expensesCollection.add(expense.toMap()).await()
            docRef.id
        } catch (e: Exception) {
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
            // ignored
        }
    }

    /**
     * 지출 삭제
     */
    suspend fun deleteExpense(expenseId: String) {
        try {
            expensesCollection.document(expenseId).delete().await()
        } catch (e: Exception) {
            // ignored
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
                    trySend(emptyList())
                    return@addSnapshotListener
                }

                val expenses = snapshot?.documents?.mapNotNull { doc ->
                    try {
                        doc.toObject(Expense::class.java)?.copy(id = doc.id)
                    } catch (e: Exception) {
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
            // ignored
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
            // ignored
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
            // ignored
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
            emptyList()
        }
    }

    /**
     * 정산 대기 중인 지출 찾기 (pendingSettlement == true)
     * 금액이 일치하는 것만 반환
     */
    suspend fun findPendingSettlement(householdId: String, amount: Int): Expense? {
        return try {
            // pendingSettlement == true인 것만 쿼리 (효율적)
            val snapshot = expensesCollection
                .whereEqualTo("householdId", householdId)
                .whereEqualTo("pendingSettlement", true)
                .get()
                .await()

            val pendingExpenses = snapshot.documents
                .mapNotNull { doc ->
                    doc.toObject(Expense::class.java)?.copy(id = doc.id)
                }

            // 금액이 일치하는 것 찾기 (여러 개면 가장 최근 것)
            pendingExpenses
                .filter { it.amount == amount }
                .maxByOrNull { it.settlementRequestedAt }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * 지출 정산 완료 처리
     * @param settledBy 정산한 사람 이름 (토스뱅크 카톡: 이진선, 새마을금고 SMS: 이민규)
     */
    suspend fun markAsSettled(expenseId: String, settledBy: String) {
        try {
            val now = java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ISO_LOCAL_DATE_TIME)

            expensesCollection.document(expenseId)
                .update(
                    mapOf(
                        "settled" to true,
                        "settledAt" to now,
                        "settledBy" to settledBy,
                        "pendingSettlement" to com.google.firebase.firestore.FieldValue.delete()
                    )
                )
                .await()
        } catch (e: Exception) {
            // ignored
        }
    }
}
