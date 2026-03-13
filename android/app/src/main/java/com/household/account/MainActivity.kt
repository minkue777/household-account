package com.household.account

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
import com.household.account.data.BalanceRepository
import com.household.account.data.CategoryRepository
import com.household.account.data.Expense
import com.household.account.data.ExpenseRepository
import com.household.account.data.MerchantRuleRepository
import com.household.account.parser.KBCardParser
import com.household.account.parser.LocalCurrencyParser
import com.household.account.parser.NHPayParser
import com.household.account.parser.ParseResult
import com.household.account.util.FcmTokenManager
import com.household.account.util.HouseholdPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    companion object {
        private const val WEB_APP_URL = "https://household-account-app-demo-v1.vercel.app/"
        private const val SAMPLE_NH_PAY_PACKAGE = "nh.smart.nhallonepay"
        private const val SAMPLE_DAEJEON_PAY_PACKAGE = "kr.co.nmcs.daejeonpay"

        private val SAMPLE_NH_PAY_NOTIFICATION = """
            NH pay
            NH농협카드
            NH카드2*4*승인
            박*태
            5,000원 일시불
            03/10 12:11
            보우리집 공정거래
            총누적555,430원
        """.trimIndent()

        private val SAMPLE_DAEJEON_PAY_NOTIFICATION = """
            승인
            온통대전 체크카드(5188) 승인 70,000원 캐시백적립 6,944원
            03/08 15:58 지에스텍(주)구봉셀프주유소 잔액46,248원
        """.trimIndent()
    }

    private data class SampleNotification(
        val label: String,
        val packageName: String,
        val fullText: String,
        val supportsBalanceSave: Boolean = false
    )

    private lateinit var webView: WebView
    private lateinit var permissionLayout: LinearLayout

    private val activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val expenseRepository = ExpenseRepository()
    private val ruleRepository = MerchantRuleRepository()
    private val categoryRepository = CategoryRepository()
    private val balanceRepository = BalanceRepository()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        permissionLayout = findViewById(R.id.permissionLayout)

        setupWebView()
        setupPermissionButtons()
        setupTestButton()
        checkPermissionAndShowContent()
    }

    override fun onDestroy() {
        activityScope.cancel()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        checkPermissionAndShowContent()
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun setupWebView() {
        webView.apply {
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    syncHouseholdKeyFromLocalStorage()
                }
            }
            webChromeClient = WebChromeClient()

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                loadWithOverviewMode = true
                useWideViewPort = true
            }

            addJavascriptInterface(WebViewBridge(this@MainActivity), WebViewBridge.BRIDGE_NAME)
        }
    }

    private fun syncHouseholdKeyFromLocalStorage() {
        val script = """
            (function() {
                var key = localStorage.getItem('householdKey');
                if (key && key.length > 0) {
                    AndroidBridge.setHouseholdKey(key);
                }
                var memberName = localStorage.getItem('currentMemberName');
                if (memberName && memberName.length > 0) {
                    AndroidBridge.setMemberName(memberName);
                }
                var partnerName = localStorage.getItem('partnerName');
                if (partnerName && partnerName.length > 0) {
                    AndroidBridge.setPartnerName(partnerName);
                }
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    private fun setupPermissionButtons() {
        findViewById<Button>(R.id.btnRequestPermission).setOnClickListener {
            openNotificationListenerSettings()
        }

        findViewById<Button>(R.id.btnRequestOverlayPermission)?.setOnClickListener {
            openOverlaySettings()
        }

        findViewById<Button>(R.id.btnCheckPermission).setOnClickListener {
            checkPermissionAndShowContent()
        }
    }

    private fun setupTestButton() {
        findViewById<ExtendedFloatingActionButton>(R.id.fabNotificationTest).setOnClickListener {
            showSampleTestDialog()
        }
    }

    private fun checkPermissionAndShowContent() {
        val hasNotificationPermission = isNotificationListenerEnabled()
        val hasOverlayPermission = isOverlayPermissionGranted()

        if (hasNotificationPermission && hasOverlayPermission) {
            showWebView()
        } else {
            showPermissionScreen()
            updatePermissionUI(hasNotificationPermission, hasOverlayPermission)
        }
    }

    private fun isOverlayPermissionGranted(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }
    }

    private fun updatePermissionUI(hasNotification: Boolean, hasOverlay: Boolean) {
        val btnNotification = findViewById<Button>(R.id.btnRequestPermission)
        btnNotification.isEnabled = !hasNotification
        btnNotification.text = if (hasNotification) {
            "알림 권한 ✓"
        } else {
            "알림 접근 권한 설정"
        }

        val btnOverlay = findViewById<Button>(R.id.btnRequestOverlayPermission)
        btnOverlay?.let {
            it.visibility = View.VISIBLE
            it.isEnabled = !hasOverlay
            it.text = if (hasOverlay) {
                "오버레이 권한 ✓"
            } else {
                "다른 앱 위에 표시 권한 설정"
            }
        }
    }

    private fun openOverlaySettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }
    }

    private fun showWebView() {
        permissionLayout.visibility = View.GONE
        webView.visibility = View.VISIBLE

        if (webView.url == null) {
            webView.loadUrl(WEB_APP_URL)
        }

        if (HouseholdPreferences.hasHouseholdKey(this) &&
            HouseholdPreferences.getMemberName(this).isNotEmpty()
        ) {
            FcmTokenManager.registerCurrentToken(this)
        }
    }

    private fun showPermissionScreen() {
        webView.visibility = View.GONE
        permissionLayout.visibility = View.VISIBLE
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return flat?.contains(packageName) == true
    }

    private fun openNotificationListenerSettings() {
        startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    private fun showSampleTestDialog() {
        val samples = listOf(
            SampleNotification(
                label = "NH Pay 샘플",
                packageName = SAMPLE_NH_PAY_PACKAGE,
                fullText = SAMPLE_NH_PAY_NOTIFICATION
            ),
            SampleNotification(
                label = "대전사랑카드 샘플",
                packageName = SAMPLE_DAEJEON_PAY_PACKAGE,
                fullText = SAMPLE_DAEJEON_PAY_NOTIFICATION,
                supportsBalanceSave = true
            )
        )

        AlertDialog.Builder(this)
            .setTitle("샘플 알림 테스트")
            .setItems(samples.map { it.label }.toTypedArray()) { _, which ->
                showSamplePreview(samples[which])
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    private fun showSamplePreview(sample: SampleNotification) {
        val parseResult = parseSampleNotification(sample)
        val expense = parseResult.expense
        val balanceResult = if (sample.supportsBalanceSave) {
            LocalCurrencyParser.parseBalance(sample.fullText)
        } else {
            null
        }

        if (!parseResult.success || expense == null) {
            AlertDialog.Builder(this)
                .setTitle("${sample.label} 실패")
                .setMessage(parseResult.errorMessage ?: "샘플 알림 파싱에 실패했습니다.")
                .setPositiveButton("확인", null)
                .show()
            return
        }

        val householdId = HouseholdPreferences.getHouseholdKey(this)
        val message = buildString {
            append("날짜: ${expense.date}\n")
            append("시간: ${expense.time}\n")
            append("카드: ${expense.cardLastFour}\n")
            append("가맹점: ${expense.merchant}\n")
            append("금액: ${expense.amount}원")

            if (balanceResult?.balance != null) {
                append("\n잔액: ${balanceResult.balance}원")
            }

            append("\n\n이 화면은 파서 결과 미리보기입니다.")
            append("\n'지출만 저장'을 누르면 실제 장부에 테스트 지출이 추가됩니다.")

            if (sample.supportsBalanceSave && balanceResult?.balance != null) {
                append("\n'지출+잔액 저장'을 누르면 지역화폐 잔액도 ${balanceResult.balance}원으로 갱신됩니다.")
            }

            if (householdId.isEmpty()) {
                append("\n\n현재 household 연결이 없어 저장 테스트는 할 수 없습니다.")
            }
        }

        val dialog = AlertDialog.Builder(this)
            .setTitle(sample.label)
            .setMessage(message)
            .setNegativeButton("닫기", null)

        if (householdId.isNotEmpty()) {
            dialog.setNeutralButton("지출만 저장") { _, _ ->
                saveSampleExpense(sample, expense, saveBalance = false, balanceResult = balanceResult)
            }

            if (sample.supportsBalanceSave && balanceResult?.balance != null) {
                dialog.setPositiveButton("지출+잔액 저장") { _, _ ->
                    saveSampleExpense(sample, expense, saveBalance = true, balanceResult = balanceResult)
                }
            }
        }

        dialog.show()
    }

    private fun parseSampleNotification(sample: SampleNotification): ParseResult {
        return when (sample.packageName) {
            SAMPLE_NH_PAY_PACKAGE -> NHPayParser.parse(sample.fullText)
            SAMPLE_DAEJEON_PAY_PACKAGE -> LocalCurrencyParser.parse(sample.fullText)
            else -> KBCardParser.parse(sample.fullText)
        }
    }

    private fun saveSampleExpense(
        sample: SampleNotification,
        expense: Expense,
        saveBalance: Boolean,
        balanceResult: LocalCurrencyParser.BalanceResult?
    ) {
        activityScope.launch {
            val householdId = HouseholdPreferences.getHouseholdKey(this@MainActivity)
            if (householdId.isEmpty()) {
                Toast.makeText(
                    this@MainActivity,
                    "가계부를 한 번 열어 household를 연결한 뒤 다시 시도해 주세요.",
                    Toast.LENGTH_SHORT
                ).show()
                return@launch
            }

            val savedExpense = withContext(Dispatchers.IO) {
                if (saveBalance && balanceResult?.balance != null) {
                    balanceRepository.saveLocalCurrencyBalance(
                        householdId = householdId,
                        balance = balanceResult.balance,
                        currencyType = balanceResult.currencyType ?: "지역화폐"
                    )
                }

                val mappingResult = ruleRepository.findMappingForMerchant(householdId, expense.merchant)
                val expenseToSave = if (mappingResult != null) {
                    expense.copy(
                        merchant = mappingResult.mappedMerchant,
                        category = mappingResult.mappedCategoryKey,
                        memo = "[샘플 테스트]",
                        householdId = householdId
                    )
                } else {
                    val defaultCategoryKey = categoryRepository.getDefaultCategoryKey(householdId)
                    expense.copy(
                        category = defaultCategoryKey,
                        memo = "[샘플 테스트]",
                        householdId = householdId
                    )
                }

                val documentId = expenseRepository.addExpense(expenseToSave)
                if (documentId.isNotEmpty()) {
                    expenseToSave.copy(id = documentId)
                } else {
                    null
                }
            }

            if (savedExpense == null) {
                Toast.makeText(
                    this@MainActivity,
                    "${sample.label} 저장 테스트에 실패했습니다.",
                    Toast.LENGTH_SHORT
                ).show()
                return@launch
            }

            launchSampleQuickEdit(savedExpense)

            val toastMessage = if (saveBalance && balanceResult?.balance != null) {
                "${sample.label} 지출과 잔액이 저장되었습니다."
            } else {
                "${sample.label} 지출이 저장되었습니다."
            }
            Toast.makeText(this@MainActivity, toastMessage, Toast.LENGTH_SHORT).show()
        }
    }

    private fun launchSampleQuickEdit(expense: Expense) {
        val intent = Intent(this, QuickEditActivity::class.java).apply {
            putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, expense.id)
            putExtra(QuickEditActivity.EXTRA_MERCHANT, expense.merchant)
            putExtra(QuickEditActivity.EXTRA_AMOUNT, expense.amount)
            putExtra(QuickEditActivity.EXTRA_DATE, expense.date)
            putExtra(QuickEditActivity.EXTRA_TIME, expense.time)
            putExtra(QuickEditActivity.EXTRA_CATEGORY, expense.category)
        }
        startActivity(intent)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
