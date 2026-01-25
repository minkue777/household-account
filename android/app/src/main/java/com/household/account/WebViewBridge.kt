package com.household.account

import android.content.Context
import android.util.Log
import android.webkit.JavascriptInterface
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
}
