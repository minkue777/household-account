package com.household.account

import android.annotation.SuppressLint
import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.household.account.quickedit.QuickEditCoordinator
import com.household.account.util.FidEndpointManager
import com.household.account.util.HouseholdPreferences
import com.household.account.paymentcapture.AndroidCaptureDelivery
import com.household.account.webhost.AndroidHostBridge
import com.household.account.webhost.TrustedWebOrigin
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var permissionLayout: LinearLayout
    private val pushPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

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
        lifecycleScope.launch {
            QuickEditCoordinator.resumePending(applicationContext)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val hostBridge = AndroidHostBridge(this)
        webView.apply {
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val target = request?.url?.toString() ?: return true
                    if (request.isForMainFrame && !TrustedWebOrigin.contains(target)) {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                        return true
                    }
                    return false
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
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                webView,
                AndroidHostBridge.OBJECT_NAME,
                setOf(TrustedWebOrigin.APP_ORIGIN)
            ) { _, message, sourceOrigin, isMainFrame, replyProxy ->
                if (!isMainFrame || sourceOrigin.toString() != TrustedWebOrigin.APP_ORIGIN) return@addWebMessageListener
                lifecycleScope.launch {
                    replyProxy.postMessage(hostBridge.handle(message.data.orEmpty()))
                }
            }
        }
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
            webView.loadUrl(TrustedWebOrigin.APP_URL)
        }

        requestPushPermissionOnceIfNeeded()

        if (HouseholdPreferences.hasHouseholdKey(this) &&
            HouseholdPreferences.getMemberName(this).isNotEmpty()
        ) {
            FidEndpointManager.registerCurrentInstallation(this)
            AndroidCaptureDelivery.scheduleRetry(this)
        }
    }

    /** 푸시 권한은 편의 기능이므로 알림 수집/QuickEdit 필수 권한 판정과 분리합니다. */
    private fun requestPushPermissionOnceIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return
        val preferences = getSharedPreferences("android_permission_prompts", MODE_PRIVATE)
        if (preferences.getBoolean("postNotificationsRequested", false)) return
        preferences.edit().putBoolean("postNotificationsRequested", true).apply()
        pushPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
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
