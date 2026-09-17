package com.household.account

import android.annotation.SuppressLint
import android.Manifest
import android.content.Intent
import android.content.ComponentName
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.RenderProcessGoneDetail
import android.widget.Button
import android.widget.LinearLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.withResumed
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.household.account.quickedit.QuickEditCoordinator
import com.household.account.util.HouseholdPreferences
import com.household.account.paymentcapture.AndroidCaptureDelivery
import com.household.account.startup.FirstResumeRefreshGate
import com.household.account.startup.AppLaunchDurationClock
import com.household.account.startup.OneShotExecutionGate
import com.household.account.webhost.AndroidHostBridge
import com.household.account.webhost.TrustedWebOrigin
import com.household.account.webhost.NotificationListenerAccess
import com.household.account.service.CardNotificationListenerService
import kotlinx.coroutines.launch
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay

class MainActivity : AppCompatActivity() {

    private val appLaunchDurationClock = AppLaunchDurationClock()
    private var webView: WebView? = null
    private var webMessageScope: CoroutineScope? = null
    private lateinit var permissionLayout: LinearLayout
    private lateinit var hostBridge: AndroidHostBridge
    private val resumeRefreshGate = FirstResumeRefreshGate()
    private val webStartupGate = OneShotExecutionGate()
    private var webNavigationStarted = false
    private var rendererRecoveryJob: Job? = null
    private var lastRendererRecoveryAt = 0L
    private var lastTrustedUrl = TrustedWebOrigin.APP_URL
    private var pendingNavigation: Bundle? = null
    private val pushPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        permissionLayout = findViewById(R.id.permissionLayout)

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        hostBridge = AndroidHostBridge(
            context = this,
            consumeAppLaunchDurationMillis = appLaunchDurationClock::consumeElapsedMillis
        )
        setupWebView(requireNotNull(webView))
        if (savedInstanceState?.getString("webEnvironmentVersion") == TrustedWebOrigin.ENVIRONMENT_VERSION) {
            savedInstanceState.getString("webRecoveryUrl")?.takeIf(TrustedWebOrigin::contains)?.let {
                lastTrustedUrl = it
            }
        }
        pendingNavigation = savedInstanceState?.takeIf {
            it.getString("webEnvironmentVersion") == TrustedWebOrigin.ENVIRONMENT_VERSION &&
                TrustedWebOrigin.contains(it.getString("webNavigationUrl"))
        }?.getBundle("webNavigation")
        setupPermissionButtons()
        checkPermissionAndShowContent()
    }

    override fun onResume() {
        super.onResume()
        val shouldRefresh = resumeRefreshGate.shouldRefreshContent()
        if (webView == null) {
            scheduleRendererRecovery()
        } else if (shouldRefresh) {
            checkPermissionAndShowContent()
            webView?.takeIf { it.url != null }?.let { view ->
                view.evaluateJavascript(
                    "window.dispatchEvent(new Event('household-account:android-resume'))",
                    null
                )
            }
        }
        lifecycleScope.launch {
            QuickEditCoordinator.resumePending(applicationContext)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("webEnvironmentVersion", TrustedWebOrigin.ENVIRONMENT_VERSION)
        outState.putString("webRecoveryUrl", lastTrustedUrl)
        webView?.takeIf { TrustedWebOrigin.contains(it.url) }?.let { view ->
            val navigation = Bundle()
            if (view.saveState(navigation) != null) {
                outState.putBundle("webNavigation", navigation)
                outState.putString("webNavigationUrl", view.url)
            }
        }
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        super.onDestroy()
        webView?.let { releaseWebView(it) }
    }

    private fun releaseWebView(view: WebView, rendererGone: Boolean = false) {
        if (webView !== view) return
        webView = null
        webMessageScope?.cancel()
        webMessageScope = null
        // 종료된 renderer에는 추가 메시지나 stopLoading을 보내지 않습니다.
        if (!rendererGone) {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.removeWebMessageListener(view, AndroidHostBridge.OBJECT_NAME)
            }
            view.stopLoading()
        }
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
    }

    private fun handleRendererGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        if (webView !== view) return true
        // URL·가구·거래 내용은 기록하지 않습니다.
        Log.w("HouseholdWebView", "renderer_gone crashed=${detail.didCrash()}")
        releaseWebView(view, rendererGone = true)
        pendingNavigation = null
        webNavigationStarted = false
        // 백그라운드에서는 새 renderer를 만들지 않고 다음 onResume에서 복구합니다.
        scheduleRendererRecovery()
        return true
    }

    private fun scheduleRendererRecovery() {
        if (isFinishing || isDestroyed) return
        if (rendererRecoveryJob?.isActive == true) return
        rendererRecoveryJob = lifecycleScope.launch {
            // 정상적인 첫 복구는 즉시 실행하고, 연속 종료만 재생성 간격을 둡니다.
            delay((lastRendererRecoveryAt + 1_000L - SystemClock.uptimeMillis()).coerceAtLeast(0L))
            // onResume 본문에서는 Lifecycle이 아직 STARTED일 수 있습니다.
            lifecycle.withResumed {
                if (!isFinishing && webView == null) {
                    lastRendererRecoveryAt = SystemClock.uptimeMillis()
                    checkPermissionAndShowContent()
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(view: WebView) {
        val messageScope = CoroutineScope(
            lifecycleScope.coroutineContext + SupervisorJob(lifecycleScope.coroutineContext[Job])
        )
        webMessageScope = messageScope
        view.apply {
            webViewClient = object : WebViewClient() {
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean =
                    handleRendererGone(view, detail)

                override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                    if (webView === view && TrustedWebOrigin.contains(url)) lastTrustedUrl = url!!
                }

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
                view,
                AndroidHostBridge.OBJECT_NAME,
                setOf(TrustedWebOrigin.APP_ORIGIN)
            ) { _, message, sourceOrigin, isMainFrame, replyProxy ->
                if (!isMainFrame || sourceOrigin.toString() != TrustedWebOrigin.APP_ORIGIN) return@addWebMessageListener
                messageScope.launch {
                    val response = hostBridge.handle(message.data.orEmpty())
                    ensureActive()
                    if (webView === view) replyProxy.postMessage(response)
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
        val view = webView ?: WebView(this).also {
            it.id = R.id.webView
            it.layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
            webView = it
            setupWebView(it)
            findViewById<ViewGroup>(R.id.container).addView(it, 0)
        }
        view.visibility = View.VISIBLE

        if (!webNavigationStarted) {
            webNavigationStarted = true
            pendingNavigation?.let { view.restoreState(it) }
            pendingNavigation = null
            // WebView Firebase Auth가 남아 있으면 그 세션을 즉시 재사용합니다.
            // 세션이 없는 경우에만 Web이 Native bridge에 교환을 요청하므로 앱을
            // 열 때마다 Cloud Function을 선행 호출하지 않습니다.
            if (view.url == null) view.loadUrl(lastTrustedUrl)
        }

        if (!webStartupGate.tryEnter()) return
        requestPushPermissionOnceIfNeeded()

        val appContext = applicationContext
        AndroidCaptureDelivery.scheduleRetry(appContext) {
            HouseholdPreferences.snapshot(appContext)?.memberName?.isNotEmpty() == true
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
        webView?.visibility = View.GONE
        permissionLayout.visibility = View.VISIBLE
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return NotificationListenerAccess.isEnabled(flat, ComponentName(this, CardNotificationListenerService::class.java))
    }

    private fun openNotificationListenerSettings() {
        startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val view = webView
        if (view?.visibility == View.VISIBLE && view.canGoBack()) {
            view.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
