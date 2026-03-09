package com.household.account.util

import android.content.Context
import android.content.SharedPreferences

/**
 * 가구 키 관리를 위한 SharedPreferences 유틸리티
 * WebView의 localStorage와 동기화하여 네이티브 서비스에서 사용
 */
object HouseholdPreferences {

    private const val PREF_NAME = "household_prefs"
    private const val KEY_HOUSEHOLD_ID = "householdKey"
    private const val KEY_MEMBER_NAME = "memberName"
    private const val KEY_PARTNER_NAME = "partnerName"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    }

    /**
     * 가구 키 저장
     */
    fun setHouseholdKey(context: Context, key: String) {
        getPrefs(context).edit().putString(KEY_HOUSEHOLD_ID, key).apply()
    }

    /**
     * 가구 키 조회
     */
    fun getHouseholdKey(context: Context): String {
        return getPrefs(context).getString(KEY_HOUSEHOLD_ID, "") ?: ""
    }

    /**
     * 가구 키 삭제 (로그아웃)
     */
    fun clearHouseholdKey(context: Context) {
        getPrefs(context).edit().remove(KEY_HOUSEHOLD_ID).apply()
    }

    /**
     * 가구 키가 설정되어 있는지 확인
     */
    fun hasHouseholdKey(context: Context): Boolean {
        return getHouseholdKey(context).isNotEmpty()
    }

    /**
     * 현재 멤버 이름 저장
     */
    fun setMemberName(context: Context, name: String) {
        getPrefs(context).edit().putString(KEY_MEMBER_NAME, name).apply()
    }

    /**
     * 현재 멤버 이름 조회
     */
    fun getMemberName(context: Context): String {
        return getPrefs(context).getString(KEY_MEMBER_NAME, "") ?: ""
    }

    /**
     * 파트너 이름 저장
     */
    fun setPartnerName(context: Context, name: String) {
        getPrefs(context).edit().putString(KEY_PARTNER_NAME, name).apply()
    }

    /**
     * 파트너 이름 조회
     */
    fun getPartnerName(context: Context): String {
        return getPrefs(context).getString(KEY_PARTNER_NAME, "") ?: ""
    }
}
