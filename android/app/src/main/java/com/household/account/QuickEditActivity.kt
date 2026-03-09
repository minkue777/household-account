package com.household.account

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.flexbox.FlexboxLayout
import com.household.account.data.CategoryData
import com.household.account.data.CategoryRepository
import com.household.account.data.Expense
import com.household.account.data.ExpenseRepository
import com.household.account.util.HouseholdPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.util.Locale

/**
 * 지출 수정 액티비티
 * 카드 결제 알림 후 가맹점, 금액, 카테고리, 메모를 수정할 수 있는 화면
 */
class QuickEditActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_EXPENSE_ID = "expense_id"
        const val EXTRA_MERCHANT = "merchant"
        const val EXTRA_AMOUNT = "amount"
        const val EXTRA_DATE = "date"
        const val EXTRA_TIME = "time"
        const val EXTRA_CATEGORY = "category"
    }

    private val activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val expenseRepository = ExpenseRepository()
    private val categoryRepository = CategoryRepository()

    // 원본 데이터
    private var expenseId: String = ""
    private var originalMerchant: String = ""
    private var originalAmount: Int = 0
    private var originalCategory: String = ""
    private var originalDate: String = ""
    private var originalTime: String = ""

    // 현재 선택된 값들
    private var selectedCategoryKey: String = ""
    private var categories: List<CategoryData> = emptyList()
    private val categoryViews = mutableMapOf<String, View>()

    // UI 요소
    private lateinit var etMerchant: EditText
    private lateinit var etAmount: EditText
    private lateinit var etMemo: EditText
    private lateinit var categoryContainer: FlexboxLayout
    private lateinit var tvDateTime: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setupWindowStyle()
        setFinishOnTouchOutside(false)  // 외부 터치해도 닫히지 않음
        setContentView(R.layout.activity_quick_edit)

        // Intent 데이터 추출
        expenseId = intent.getStringExtra(EXTRA_EXPENSE_ID) ?: ""
        originalMerchant = intent.getStringExtra(EXTRA_MERCHANT) ?: ""
        originalAmount = intent.getIntExtra(EXTRA_AMOUNT, 0)
        originalDate = intent.getStringExtra(EXTRA_DATE) ?: ""
        originalTime = intent.getStringExtra(EXTRA_TIME) ?: ""
        originalCategory = intent.getStringExtra(EXTRA_CATEGORY) ?: "etc"

        // 카테고리 키 정규화 (대문자 -> 소문자)
        selectedCategoryKey = originalCategory.lowercase()

        initViews()
        setupUI()
        loadCategories()
        setupButtons()
    }

    private fun setupWindowStyle() {
        window.setLayout(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT
        )
        window.setGravity(Gravity.BOTTOM)
        window.setBackgroundDrawableResource(android.R.color.white)
        window.attributes = window.attributes.apply {
            dimAmount = 0.5f
            flags = flags or WindowManager.LayoutParams.FLAG_DIM_BEHIND
        }
        window.decorView.setPadding(0, 0, 0, 0)
    }

    private fun initViews() {
        etMerchant = findViewById(R.id.etMerchant)
        etAmount = findViewById(R.id.etAmount)
        etMemo = findViewById(R.id.etMemo)
        categoryContainer = findViewById(R.id.categoryContainer)
        tvDateTime = findViewById(R.id.tvDateTime)
    }

    private fun setupUI() {
        // 가맹점
        etMerchant.setText(originalMerchant)

        // 금액
        etAmount.setText(originalAmount.toString())

        // 날짜/시간 포맷팅
        val dateTime = buildString {
            if (originalDate.length >= 10) {
                append(originalDate.substring(5, 7))
                append("/")
                append(originalDate.substring(8, 10))
            }
            if (originalTime.isNotEmpty()) {
                append(" ")
                append(originalTime)
            }
        }
        tvDateTime.text = dateTime
    }

    private fun loadCategories() {
        activityScope.launch {
            try {
                val householdId = HouseholdPreferences.getHouseholdKey(this@QuickEditActivity)
                categories = withContext(Dispatchers.IO) {
                    categoryRepository.getActiveCategories(householdId)
                }
                setupCategoryButtons()
            } catch (e: Exception) {
                // 기본 카테고리 사용
                categories = CategoryRepository.DEFAULT_CATEGORIES
                setupCategoryButtons()
            }
        }
    }

    private fun setupCategoryButtons() {
        categoryContainer.removeAllViews()
        categoryViews.clear()

        categories.forEach { category ->
            val button = createCategoryButton(category)
            categoryViews[category.key] = button
            categoryContainer.addView(button)

            button.setOnClickListener {
                selectCategory(category.key)
            }
        }

        updateCategorySelection()
    }

    private fun createCategoryButton(category: CategoryData): LinearLayout {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(24, 16, 24, 16)

            val params = FlexboxLayout.LayoutParams(
                FlexboxLayout.LayoutParams.WRAP_CONTENT,
                FlexboxLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 12, 12)
            }
            layoutParams = params
        }

        // 색상 원
        val colorCircle = View(this).apply {
            val size = (24 * resources.displayMetrics.density).toInt()
            layoutParams = LinearLayout.LayoutParams(size, size).apply {
                bottomMargin = (4 * resources.displayMetrics.density).toInt()
            }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor(category.color))
            }
        }

        // 라벨
        val label = TextView(this).apply {
            text = category.label.take(2)
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
            gravity = Gravity.CENTER
        }

        container.addView(colorCircle)
        container.addView(label)

        return container
    }

    private fun selectCategory(categoryKey: String) {
        selectedCategoryKey = categoryKey
        updateCategorySelection()
    }

    private fun updateCategorySelection() {
        categoryViews.forEach { (key, view) ->
            val isSelected = key == selectedCategoryKey

            val background = GradientDrawable().apply {
                cornerRadius = 12 * resources.displayMetrics.density
                if (isSelected) {
                    setColor(Color.parseColor("#EFF6FF"))
                    setStroke(
                        (2 * resources.displayMetrics.density).toInt(),
                        Color.parseColor("#3B82F6")
                    )
                } else {
                    setColor(Color.TRANSPARENT)
                    setStroke(
                        (1 * resources.displayMetrics.density).toInt(),
                        Color.parseColor("#E2E8F0")
                    )
                }
            }
            view.background = background
        }
    }

    private fun setupButtons() {
        // 닫기 버튼
        findViewById<ImageButton>(R.id.btnClose).setOnClickListener {
            finish()
        }

        // 저장 버튼
        findViewById<Button>(R.id.btnSave).setOnClickListener {
            saveChanges(notifyPartner = false)
        }

        // 파트너에게 전송 버튼 (저장 없이 알림만)
        val partnerName = HouseholdPreferences.getPartnerName(this)
        val btnNotify = findViewById<Button>(R.id.btnNotify)
        btnNotify.text = if (partnerName.isNotEmpty()) "${partnerName}에게" else "전송"
        btnNotify.setOnClickListener {
            sendNotifyOnly()
        }

        // 나누기 버튼
        findViewById<Button>(R.id.btnSplit).setOnClickListener {
            showSplitDialog()
        }

        // 삭제 버튼
        findViewById<Button>(R.id.btnDelete).setOnClickListener {
            showDeleteConfirmation()
        }
    }

    /**
     * 저장 없이 파트너에게 알림만 전송
     */
    private fun sendNotifyOnly() {
        if (expenseId.isEmpty()) {
            finish()
            return
        }

        activityScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    expenseRepository.updateExpenseAllFields(
                        expenseId = expenseId,
                        notifyPartner = true
                    )
                }
                val pName = HouseholdPreferences.getPartnerName(this@QuickEditActivity)
                val toastMsg = if (pName.isNotEmpty()) "${pName}에게 전송됨" else "전송됨"
                Toast.makeText(this@QuickEditActivity, toastMsg, Toast.LENGTH_SHORT).show()
                finish()
            } catch (e: Exception) {
                Toast.makeText(this@QuickEditActivity, "전송에 실패했습니다", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun saveChanges(notifyPartner: Boolean) {
        val merchant = etMerchant.text.toString().trim()
        val amountStr = etAmount.text.toString().trim()
        val memo = etMemo.text.toString().trim()

        if (merchant.isEmpty()) {
            Toast.makeText(this, "가맹점명을 입력해주세요", Toast.LENGTH_SHORT).show()
            return
        }

        val amount = amountStr.toIntOrNull()
        if (amount == null || amount <= 0) {
            Toast.makeText(this, "올바른 금액을 입력해주세요", Toast.LENGTH_SHORT).show()
            return
        }

        if (expenseId.isEmpty()) {
            finish()
            return
        }

        activityScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    expenseRepository.updateExpenseAllFields(
                        expenseId = expenseId,
                        merchant = if (merchant != originalMerchant) merchant else null,
                        amount = if (amount != originalAmount) amount else null,
                        category = if (selectedCategoryKey != originalCategory.lowercase()) selectedCategoryKey else null,
                        memo = memo.ifEmpty { null },
                        notifyPartner = notifyPartner
                    )
                }
                val pName = HouseholdPreferences.getPartnerName(this@QuickEditActivity)
                val message = if (notifyPartner) {
                    if (pName.isNotEmpty()) "저장 및 ${pName}에게 전송됨" else "저장 및 전송됨"
                } else "저장되었습니다"
                Toast.makeText(this@QuickEditActivity, message, Toast.LENGTH_SHORT).show()
                finish()
            } catch (e: Exception) {
                Toast.makeText(this@QuickEditActivity, "저장에 실패했습니다", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showDeleteConfirmation() {
        AlertDialog.Builder(this)
            .setTitle("삭제 확인")
            .setMessage("\"$originalMerchant\" ${NumberFormat.getNumberInstance(Locale.KOREA).format(originalAmount)}원을 삭제하시겠습니까?")
            .setPositiveButton("삭제") { _, _ ->
                deleteExpense()
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun deleteExpense() {
        if (expenseId.isEmpty()) {
            finish()
            return
        }

        activityScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    expenseRepository.deleteExpense(expenseId)
                }
                Toast.makeText(this@QuickEditActivity, "삭제되었습니다", Toast.LENGTH_SHORT).show()
                finish()
            } catch (e: Exception) {
                Toast.makeText(this@QuickEditActivity, "삭제에 실패했습니다", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showSplitDialog() {
        val currentAmount = etAmount.text.toString().toIntOrNull() ?: originalAmount
        val currentMerchant = etMerchant.text.toString().ifEmpty { originalMerchant }

        val dialog = AlertDialog.Builder(this, R.style.Theme_QuickEdit)
            .create()

        val view = LayoutInflater.from(this).inflate(R.layout.dialog_split_expense, null)
        dialog.setView(view)

        // 분할 항목 데이터
        data class SplitItem(
            var merchant: String,
            var amount: Int,
            var category: String,
            var memo: String
        )

        val splits = mutableListOf(
            SplitItem(currentMerchant, currentAmount / 2, selectedCategoryKey, ""),
            SplitItem(currentMerchant, currentAmount - currentAmount / 2, selectedCategoryKey, "")
        )

        val splitItemsContainer = view.findViewById<LinearLayout>(R.id.splitItemsContainer)
        val tvSplitInfo = view.findViewById<TextView>(R.id.tvSplitInfo)

        tvSplitInfo.text = "$currentMerchant ${NumberFormat.getNumberInstance(Locale.KOREA).format(currentAmount)}원을 여러 항목으로 나눕니다"

        // 각 항목의 EditText 참조 저장 (자동 금액 조정용)
        val amountEditTexts = mutableListOf<EditText>()
        var isAutoAdjusting = false  // 재귀 호출 방지 플래그

        fun renderSplitItems() {
            splitItemsContainer.removeAllViews()
            amountEditTexts.clear()

            splits.forEachIndexed { index, split ->
                val itemView = LayoutInflater.from(this).inflate(R.layout.item_split_expense, splitItemsContainer, false)

                itemView.findViewById<TextView>(R.id.tvItemNumber).text = "항목 ${index + 1}"

                val etMerchant = itemView.findViewById<EditText>(R.id.etMerchant)
                val etAmount = itemView.findViewById<EditText>(R.id.etAmount)
                val etMemo = itemView.findViewById<EditText>(R.id.etMemo)
                val btnRemove = itemView.findViewById<ImageButton>(R.id.btnRemove)
                val categoryContainer = itemView.findViewById<FlexboxLayout>(R.id.categoryContainer)

                etMerchant.setText(split.merchant)
                etAmount.setText(split.amount.toString())
                etMemo.setText(split.memo)

                amountEditTexts.add(etAmount)

                // 삭제 버튼 (3개 이상일 때만 표시)
                btnRemove.visibility = if (splits.size > 2) View.VISIBLE else View.GONE
                btnRemove.setOnClickListener {
                    splits.removeAt(index)
                    renderSplitItems()
                }

                // 카테고리 버튼들
                categories.forEach { category ->
                    val catButton = createSmallCategoryButton(category, split.category == category.key)
                    catButton.setOnClickListener {
                        split.category = category.key
                        renderSplitItems()
                    }
                    categoryContainer.addView(catButton)
                }

                // 텍스트 변경 리스너
                etMerchant.addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                    override fun afterTextChanged(s: Editable?) {
                        split.merchant = s.toString()
                    }
                })

                etAmount.addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                    override fun afterTextChanged(s: Editable?) {
                        if (isAutoAdjusting) return

                        val newAmount = s.toString().toIntOrNull() ?: 0
                        split.amount = newAmount

                        // 2개 항목일 때만 다른 쪽 자동 조정
                        if (splits.size == 2) {
                            val otherIndex = if (index == 0) 1 else 0
                            val otherAmount = maxOf(0, currentAmount - newAmount)
                            splits[otherIndex].amount = otherAmount

                            // 다른 EditText 업데이트
                            if (amountEditTexts.size == 2) {
                                isAutoAdjusting = true
                                amountEditTexts[otherIndex].setText(otherAmount.toString())
                                isAutoAdjusting = false
                            }
                        }
                    }
                })

                etMemo.addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                    override fun afterTextChanged(s: Editable?) {
                        split.memo = s.toString()
                    }
                })

                splitItemsContainer.addView(itemView)
            }
        }

        // 항목 추가 버튼
        view.findViewById<Button>(R.id.btnAddSplit).setOnClickListener {
            val totalUsed = splits.sumOf { it.amount }
            val remaining = maxOf(0, currentAmount - totalUsed)
            splits.add(SplitItem(currentMerchant, remaining, selectedCategoryKey, ""))
            renderSplitItems()
        }

        // 취소 버튼
        view.findViewById<Button>(R.id.btnCancelSplit).setOnClickListener {
            dialog.dismiss()
        }

        // 나누기 확인 버튼
        view.findViewById<Button>(R.id.btnConfirmSplit).setOnClickListener {
            val total = splits.sumOf { it.amount }
            if (total != currentAmount) {
                Toast.makeText(this, "분할 금액의 합이 원래 금액과 일치하지 않습니다", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (splits.any { it.amount <= 0 }) {
                Toast.makeText(this, "모든 분할 항목의 금액은 0보다 커야 합니다", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            // 분할 실행
            activityScope.launch {
                try {
                    val householdId = HouseholdPreferences.getHouseholdKey(this@QuickEditActivity)
                    val expenseList = splits.map { split ->
                        Expense(
                            date = originalDate,
                            time = originalTime,
                            merchant = split.merchant,
                            amount = split.amount,
                            category = split.category,
                            memo = split.memo,
                            householdId = householdId
                        )
                    }

                    withContext(Dispatchers.IO) {
                        expenseRepository.splitExpense(expenseId, expenseList)
                    }

                    Toast.makeText(this@QuickEditActivity, "분할되었습니다", Toast.LENGTH_SHORT).show()
                    dialog.dismiss()
                    finish()
                } catch (e: Exception) {
                    Toast.makeText(this@QuickEditActivity, "분할에 실패했습니다", Toast.LENGTH_SHORT).show()
                }
            }
        }

        renderSplitItems()

        dialog.show()

        // 다이얼로그 크기 설정
        dialog.window?.setLayout(
            WindowManager.LayoutParams.MATCH_PARENT,
            (resources.displayMetrics.heightPixels * 0.85).toInt()
        )
    }

    private fun createSmallCategoryButton(category: CategoryData, isSelected: Boolean): LinearLayout {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(16, 8, 16, 8)

            val params = FlexboxLayout.LayoutParams(
                FlexboxLayout.LayoutParams.WRAP_CONTENT,
                FlexboxLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 8, 8)
            }
            layoutParams = params

            background = GradientDrawable().apply {
                cornerRadius = 8 * resources.displayMetrics.density
                if (isSelected) {
                    setColor(Color.parseColor("#EFF6FF"))
                    setStroke(
                        (2 * resources.displayMetrics.density).toInt(),
                        Color.parseColor("#3B82F6")
                    )
                } else {
                    setColor(Color.TRANSPARENT)
                    setStroke(
                        (1 * resources.displayMetrics.density).toInt(),
                        Color.parseColor("#E2E8F0")
                    )
                }
            }
        }

        // 색상 원
        val colorCircle = View(this).apply {
            val size = (12 * resources.displayMetrics.density).toInt()
            layoutParams = LinearLayout.LayoutParams(size, size).apply {
                marginEnd = (6 * resources.displayMetrics.density).toInt()
            }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor(category.color))
            }
        }

        // 라벨
        val label = TextView(this).apply {
            text = category.label
            textSize = 12f
            setTextColor(Color.parseColor("#475569"))
        }

        container.addView(colorCircle)
        container.addView(label)

        return container
    }
}
