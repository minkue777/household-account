package com.household.account

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    companion object {
        private const val WEB_APP_URL = "https://household-account-app-demo-v1.vercel.app/"
    }

    private lateinit var webView: WebView
    private lateinit var permissionLayout: LinearLayout
    private lateinit var testButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        permissionLayout = findViewById(R.id.permissionLayout)
        testButton = findViewById(R.id.btnTestPopup)

        setupWebView()
        setupPermissionButtons()
        setupTestButton()

        checkPermissionAndShowContent()
    }

    private fun setupTestButton() {
        testButton.setOnClickListener {
            // 테스트용 QuickEditActivity 실행
            val intent = Intent(this, QuickEditActivity::class.java).apply {
                putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, "test_id_${System.currentTimeMillis()}")
                putExtra(QuickEditActivity.EXTRA_MERCHANT, "테스트 가맹점")
                putExtra(QuickEditActivity.EXTRA_AMOUNT, 25000)
                putExtra(QuickEditActivity.EXTRA_DATE, java.time.LocalDate.now().toString())
                putExtra(QuickEditActivity.EXTRA_TIME, java.time.LocalTime.now().toString().substring(0, 5))
                putExtra(QuickEditActivity.EXTRA_CATEGORY, "ETC")
            }
            startActivity(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        // 설정에서 돌아왔을 때 권한 다시 체크
        checkPermissionAndShowContent()
    }

    private fun setupWebView() {
        webView.apply {
            webViewClient = WebViewClient()
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
        }
    }

    private fun setupPermissionButtons() {
        findViewById<Button>(R.id.btnRequestPermission).setOnClickListener {
            openNotificationListenerSettings()
        }

        findViewById<Button>(R.id.btnCheckPermission).setOnClickListener {
            checkPermissionAndShowContent()
        }
    }

    private fun checkPermissionAndShowContent() {
        if (isNotificationListenerEnabled()) {
            showWebView()
        } else {
            showPermissionScreen()
        }
    }

    private fun showWebView() {
        permissionLayout.visibility = View.GONE
        webView.visibility = View.VISIBLE
        testButton.visibility = View.VISIBLE

        // 이미 로드된 경우 다시 로드하지 않음
        if (webView.url == null) {
            webView.loadUrl(WEB_APP_URL)
        }
    }

    private fun showPermissionScreen() {
        webView.visibility = View.GONE
        testButton.visibility = View.GONE
        permissionLayout.visibility = View.VISIBLE
    }

    /**
     * 알림 접근 권한이 활성화되어 있는지 확인
     */
    private fun isNotificationListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(
            contentResolver,
            "enabled_notification_listeners"
        )
        return flat?.contains(packageName) == true
    }

    /**
     * 알림 접근 설정 화면 열기
     */
    private fun openNotificationListenerSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        startActivity(intent)
    }

    /**
     * 뒤로가기 버튼 처리 - WebView 히스토리 지원
     */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
