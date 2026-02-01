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
     * 가장 최근 정산 요청된 지출 찾기 + 시간 검증 + 금액 검증
     * 1. settlementRequestedAt이 가장 최근인 미정산 지출 찾기
     * 2. 정산 요청이 1분 이내인지 확인
     * 3. 금액이 일치하는지 확인
     */
    suspend fun findUnsettledExpenseByAmount(householdId: String, amount: Int): Expense? {
        return try {
            // householdId로만 쿼리 (settled 필드가 없을 수 있음)
            val snapshot = expensesCollection
                .whereEqualTo("householdId", householdId)
                .get()
                .await()

            val now = java.time.Instant.now()
            val oneMinuteAgo = now.minusSeconds(60)

            val expenses = snapshot.documents
                .mapNotNull { doc ->
                    doc.toObject(Expense::class.java)?.copy(id = doc.id)
                }
                .filter { expense ->
                    // settled가 없거나 false인 것만
                    !expense.settled
                }
                .filter { expense ->
                    // cardType이 main, family가 아니고, 정산 요청이 있는 것
                    val cardType = expense.cardType.uppercase()
                    cardType != "MAIN" && cardType != "FAMILY" && expense.settlementRequestedAt.isNotEmpty()
                }
                .filter { expense ->
                    // 정산 요청이 1분 이내인지 확인
                    try {
                        val requestTime = java.time.Instant.parse(expense.settlementRequestedAt)
                        requestTime.isAfter(oneMinuteAgo)
                    } catch (e: Exception) {
                        false
                    }
                }
                .sortedByDescending { it.settlementRequestedAt }

            // 가장 최근 정산 요청된 것이 금액과 일치하면 반환
            val mostRecentRequest = expenses.firstOrNull()
            if (mostRecentRequest != null && mostRecentRequest.amount == amount) {
                mostRecentRequest
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * 지출 정산 완료 처리
     */
    suspend fun markAsSettled(expenseId: String) {
        try {
            val now = java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ISO_LOCAL_DATE_TIME)

            expensesCollection.document(expenseId)
                .update(
                    mapOf(
                        "settled" to true,
                        "settledAt" to now
                    )
                )
                .await()
        } catch (e: Exception) {
            // ignored
        }
    }
}
