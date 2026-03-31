package com.household.account

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import com.household.account.util.FcmTokenManager
import com.household.account.util.HouseholdPreferences

/**
 * WebView와 네이티브 코드 간의 브리지
 * localStorage의 householdKey를 SharedPreferences에 동기화
 */
class WebViewBridge(private val context: Context) {

    companion object {
        private const val TAG = "WebViewBridge"
        const val BRIDGE_NAME = "AndroidBridge"
    }

    /**
     * JavaScript에서 호출: 가구 키 저장
     * @param key 가구 키
     */
    @JavascriptInterface
    fun setHouseholdKey(key: String) {
        Log.d(TAG, "setHouseholdKey: $key")
        HouseholdPreferences.setHouseholdKey(context, key)
    }

    /**
     * JavaScript에서 호출: 가구 키 조회
     * @return 저장된 가구 키
     */
    @JavascriptInterface
    fun getHouseholdKey(): String {
        val key = HouseholdPreferences.getHouseholdKey(context)
        Log.d(TAG, "getHouseholdKey: $key")
        return key
    }

    /**
     * JavaScript에서 호출: 가구 키 삭제
     */
    @JavascriptInterface
    fun clearHouseholdKey() {
        Log.d(TAG, "clearHouseholdKey")
        HouseholdPreferences.clearHouseholdKey(context)
    }

    /**
     * JavaScript에서 호출: 현재 멤버 이름 저장
     */
    @JavascriptInterface
    fun setMemberName(name: String) {
        Log.d(TAG, "setMemberName: $name")
        HouseholdPreferences.setMemberName(context, name)
        // 멤버 이름 설정 후 FCM 토큰 등록/갱신
        FcmTokenManager.registerCurrentToken(context)
    }

    /**
     * JavaScript에서 호출: 파트너 이름 저장
     */
    @JavascriptInterface
    fun setPartnerName(name: String) {
        Log.d(TAG, "setPartnerName: $name")
        HouseholdPreferences.setPartnerName(context, name)
    }

    /**
     * JavaScript에서 호출: 현재 설치된 안드로이드 앱 버전 조회
     */
    @JavascriptInterface
    fun getAppVersion(): String {
        val versionName = try {
            val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.PackageInfoFlags.of(0)
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, 0)
            }
            packageInfo.versionName ?: "알 수 없음"
        } catch (error: Exception) {
            Log.w(TAG, "getAppVersion failed", error)
            "알 수 없음"
        }

        return "현재 앱 버전 $versionName"
    }
}
