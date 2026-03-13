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
import androidx.appcompat.app.AppCompatActivity
import com.household.account.util.FcmTokenManager
import com.household.account.util.HouseholdPreferences

class MainActivity : AppCompatActivity() {

    companion object {
        private const val WEB_APP_URL = "https://household-account-app-demo-v1.vercel.app/"
    }

    private lateinit var webView: WebView
    private lateinit var permissionLayout: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        permissionLayout = findViewById(R.id.permissionLayout)

        setupWebView()
        setupPermissionButtons()
        checkPermissionAndShowContent()
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
        btnNotification.text = if (hasNotification) "알림 권한 ✓" else "알림 접근 권한 설정"

        val btnOverlay = findViewById<Button>(R.id.btnRequestOverlayPermission)
        btnOverlay?.let {
            it.visibility = View.VISIBLE
            it.isEnabled = !hasOverlay
            it.text = if (hasOverlay) "오버레이 권한 ✓" else "다른 앱 위에 표시 권한 설정"
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

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
