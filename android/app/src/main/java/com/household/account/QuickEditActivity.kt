package com.household.account

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.household.account.data.Category
import com.household.account.data.ExpenseRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.util.Locale

/**
 * 지출 빠른 편집 액티비티
 * 카드 결제 알림 후 바로 메모/카테고리를 수정할 수 있는 화면
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

    private var expenseId: String = ""
    private var selectedCategory: Category = Category.ETC
    private val categoryButtons = mutableMapOf<Category, TextView>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 팝업 스타일 설정
        setupWindowStyle()

        setContentView(R.layout.activity_quick_edit)

        // Intent 데이터 추출
        expenseId = intent.getStringExtra(EXTRA_EXPENSE_ID) ?: ""
        val merchant = intent.getStringExtra(EXTRA_MERCHANT) ?: ""
        val amount = intent.getIntExtra(EXTRA_AMOUNT, 0)
        val date = intent.getStringExtra(EXTRA_DATE) ?: ""
        val time = intent.getStringExtra(EXTRA_TIME) ?: ""
        val categoryName = intent.getStringExtra(EXTRA_CATEGORY) ?: Category.ETC.name

        selectedCategory = try {
            Category.valueOf(categoryName)
        } catch (e: Exception) {
            Category.ETC
        }

        setupUI(merchant, amount, date, time)
        setupCategoryButtons()
        setupButtons()
    }

    private fun setupWindowStyle() {
        // 다이얼로그 스타일로 표시
        window.setLayout(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT
        )
        window.setGravity(Gravity.BOTTOM)

        // 배경 딤 처리
        window.setBackgroundDrawableResource(android.R.color.white)
        window.attributes = window.attributes.apply {
            dimAmount = 0.5f
            flags = flags or WindowManager.LayoutParams.FLAG_DIM_BEHIND
        }

        // 상태바 아래서 시작하도록
        window.decorView.setPadding(0, 0, 0, 0)
    }

    private fun setupUI(merchant: String, amount: Int, date: String, time: String) {
        findViewById<TextView>(R.id.tvMerchant).text = merchant

        val formattedAmount = NumberFormat.getNumberInstance(Locale.KOREA).format(amount) + "원"
        findViewById<TextView>(R.id.tvAmount).text = formattedAmount

        // 날짜/시간 포맷팅 (2025-01-23 → 01/23)
        val dateTime = buildString {
            if (date.length >= 10) {
                append(date.substring(5, 7))
                append("/")
                append(date.substring(8, 10))
            }
            if (time.isNotEmpty()) {
                append(" ")
                append(time)
            }
        }
        findViewById<TextView>(R.id.tvDateTime).text = dateTime
    }

    private fun setupCategoryButtons() {
        val container = findViewById<LinearLayout>(R.id.categoryContainer)
        container.removeAllViews()

        Category.entries.forEach { category ->
            val button = createCategoryButton(category)
            categoryButtons[category] = button
            container.addView(button)

            button.setOnClickListener {
                selectCategory(category)
            }
        }

        // 초기 선택 상태 반영
        updateCategorySelection()
    }

    private fun createCategoryButton(category: Category): TextView {
        val button = TextView(this).apply {
            text = category.label
            textSize = 14f
            setPadding(40, 24, 40, 24)
            gravity = Gravity.CENTER

            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                marginEnd = 12
            }
            layoutParams = params
        }

        return button
    }

    private fun selectCategory(category: Category) {
        selectedCategory = category
        updateCategorySelection()
    }

    private fun updateCategorySelection() {
        categoryButtons.forEach { (category, button) ->
            val isSelected = category == selectedCategory

            val background = GradientDrawable().apply {
                cornerRadius = 50f
                if (isSelected) {
                    setColor(category.color.toInt())
                } else {
                    setColor(Color.parseColor("#F1F5F9"))
                    setStroke(2, Color.parseColor("#E2E8F0"))
                }
            }

            button.background = background
            button.setTextColor(
                if (isSelected) Color.WHITE else Color.parseColor("#475569")
            )
        }
    }

    private fun setupButtons() {
        findViewById<ImageButton>(R.id.btnClose).setOnClickListener {
            finish()
        }

        findViewById<Button>(R.id.btnSkip).setOnClickListener {
            finish()
        }

        findViewById<Button>(R.id.btnSave).setOnClickListener {
            saveChanges()
        }
    }

    private fun saveChanges() {
        val memo = findViewById<EditText>(R.id.etMemo).text.toString().trim()

        if (expenseId.isEmpty()) {
            finish()
            return
        }

        activityScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    // 카테고리와 메모 업데이트
                    expenseRepository.updateExpenseFields(
                        expenseId = expenseId,
                        category = selectedCategory.name,
                        memo = memo
                    )
                }
                finish()
            } catch (e: Exception) {
                // 에러 처리 (간단히 종료)
                finish()
            }
        }
    }
}
