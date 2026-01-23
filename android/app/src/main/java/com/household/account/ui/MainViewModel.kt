package com.household.account.ui

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.data.ExpenseRepository
import com.household.account.data.MerchantRule
import com.household.account.data.MerchantRuleRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

data class MainUiState(
    val currentYear: Int = LocalDate.now().year,
    val currentMonth: Int = LocalDate.now().monthValue,
    val selectedDate: String? = null,
    val expenses: List<Expense> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class MainViewModel : ViewModel() {

    companion object {
        private const val TAG = "MainViewModel"
    }

    private val repository = ExpenseRepository()
    private val ruleRepository = MerchantRuleRepository()

    private val _uiState = MutableStateFlow(MainUiState())
    val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()

    init {
        loadExpenses()
    }

    fun loadExpenses() {
        val state = _uiState.value
        viewModelScope.launch {
            try {
                _uiState.value = state.copy(isLoading = true)

                repository.getExpensesByMonth(state.currentYear, state.currentMonth)
                    .catch { e ->
                        Log.e(TAG, "loadExpenses error", e)
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            error = e.message
                        )
                    }
                    .collect { expenses ->
                        _uiState.value = _uiState.value.copy(
                            expenses = expenses,
                            isLoading = false,
                            error = null
                        )
                    }
            } catch (e: Exception) {
                Log.e(TAG, "loadExpenses failed", e)
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message
                )
            }
        }
    }

    fun previousMonth() {
        val state = _uiState.value
        val (newYear, newMonth) = if (state.currentMonth == 1) {
            state.currentYear - 1 to 12
        } else {
            state.currentYear to state.currentMonth - 1
        }

        _uiState.value = state.copy(
            currentYear = newYear,
            currentMonth = newMonth,
            selectedDate = null
        )
        loadExpenses()
    }

    fun nextMonth() {
        val state = _uiState.value
        val (newYear, newMonth) = if (state.currentMonth == 12) {
            state.currentYear + 1 to 1
        } else {
            state.currentYear to state.currentMonth + 1
        }

        _uiState.value = state.copy(
            currentYear = newYear,
            currentMonth = newMonth,
            selectedDate = null
        )
        loadExpenses()
    }

    fun selectDate(date: String) {
        val currentSelected = _uiState.value.selectedDate
        _uiState.value = _uiState.value.copy(
            selectedDate = if (currentSelected == date) null else date
        )
    }

    fun updateCategory(expenseId: String, category: Category) {
        viewModelScope.launch {
            try {
                repository.updateCategory(expenseId, category)
            } catch (e: Exception) {
                Log.e(TAG, "updateCategory failed", e)
                _uiState.value = _uiState.value.copy(
                    error = "카테고리 업데이트 실패: ${e.message}"
                )
            }
        }
    }

    /**
     * 가맹점 규칙 저장 (이 가맹점 기억하기)
     */
    fun saveMerchantRule(merchantName: String, category: Category, exactMatch: Boolean = true) {
        viewModelScope.launch {
            try {
                // 이미 같은 키워드 규칙이 있는지 확인
                val exists = ruleRepository.ruleExists(merchantName)
                if (exists) {
                    Log.d(TAG, "이미 규칙이 존재함: $merchantName")
                    return@launch
                }

                val rule = MerchantRule(
                    merchantKeyword = merchantName,
                    category = category.name,
                    exactMatch = exactMatch
                )
                val ruleId = ruleRepository.addRule(rule)
                if (ruleId.isNotEmpty()) {
                    Log.d(TAG, "규칙 저장 성공: $merchantName -> ${category.name}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "saveMerchantRule failed", e)
                _uiState.value = _uiState.value.copy(
                    error = "규칙 저장 실패: ${e.message}"
                )
            }
        }
    }

    fun deleteExpense(expenseId: String) {
        viewModelScope.launch {
            try {
                repository.deleteExpense(expenseId)
            } catch (e: Exception) {
                Log.e(TAG, "deleteExpense failed", e)
                _uiState.value = _uiState.value.copy(
                    error = "삭제 실패: ${e.message}"
                )
            }
        }
    }

    /**
     * 수동으로 지출 추가
     */
    fun addManualExpense(merchant: String, amount: Int, category: Category, date: String) {
        viewModelScope.launch {
            try {
                val now = LocalTime.now()
                val timeStr = now.format(DateTimeFormatter.ofPattern("HH:mm"))

                val expense = Expense(
                    date = date,
                    time = timeStr,
                    merchant = merchant,
                    amount = amount,
                    category = category.name,
                    cardType = "MAIN",
                    cardLastFour = "수동"
                )

                repository.addExpense(expense)
                Log.d(TAG, "수동 지출 추가 성공: $merchant - $amount 원")
            } catch (e: Exception) {
                Log.e(TAG, "addManualExpense failed", e)
                _uiState.value = _uiState.value.copy(
                    error = "추가 실패: ${e.message}"
                )
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    // 월간 총액
    fun getMonthlyTotal(): Int {
        return _uiState.value.expenses.sumOf { it.amount }
    }

    // 카테고리별 총액
    fun getCategoryTotals(): Map<Category, Int> {
        return _uiState.value.expenses
            .groupBy { it.getCategoryEnum() }
            .mapValues { (_, expenses) -> expenses.sumOf { it.amount } }
    }

    // 특정 날짜의 지출
    fun getExpensesForDate(date: String): List<Expense> {
        return _uiState.value.expenses.filter { it.date == date }
    }

    // 날짜별 총액
    fun getDailyTotal(date: String): Int {
        return getExpensesForDate(date).sumOf { it.amount }
    }

    // 카테고리별 지출 내역
    fun getExpensesByCategory(category: Category): List<Expense> {
        return _uiState.value.expenses
            .filter { it.getCategoryEnum() == category }
            .sortedByDescending { it.date }
    }
}
