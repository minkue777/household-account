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
    private const val KEY_MEMBER_ID = "memberId"
    private const val KEY_MEMBER_NAME = "memberName"
    private const val KEY_PARTNER_NAME = "partnerName"
    private const val KEY_SESSION_GENERATION = "sessionGeneration"
    private const val KEY_QUICK_EDIT_OVERLAY_PREFIX = "quickEditOverlayEnabled"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    }

    /**
     * 가구 키 저장
     */
    fun setHouseholdKey(context: Context, key: String) {
        val prefs = getPrefs(context)
        val normalized = key.trim()
        val previous = prefs.getString(KEY_HOUSEHOLD_ID, "").orEmpty()
        val editor = prefs.edit().putString(KEY_HOUSEHOLD_ID, normalized)
        if (previous != normalized) {
            // household 전환 중 이전 member ID가 새 가구에 붙는 혼합 identity를 차단합니다.
            editor.remove(KEY_MEMBER_ID)
            editor.putLong(KEY_SESSION_GENERATION, nextSessionGeneration(prefs))
        }
        editor.apply()
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
        val prefs = getPrefs(context)
        prefs.edit()
            .remove(KEY_HOUSEHOLD_ID)
            .remove(KEY_MEMBER_ID)
            .remove(KEY_MEMBER_NAME)
            .remove(KEY_PARTNER_NAME)
            .putLong(KEY_SESSION_GENERATION, nextSessionGeneration(prefs))
            .apply()
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

    fun setMemberId(context: Context, memberId: String) {
        val prefs = getPrefs(context)
        val normalized = memberId.trim()
        val previous = prefs.getString(KEY_MEMBER_ID, "").orEmpty()
        val editor = prefs.edit().putString(KEY_MEMBER_ID, normalized)
        if (previous != normalized) {
            editor.putLong(KEY_SESSION_GENERATION, nextSessionGeneration(prefs))
        }
        editor.apply()
    }

    /** 서버가 인증 principal에서 해석한 Membership만 원자적인 native session으로 저장합니다. */
    fun replaceAuthenticatedSession(
        context: Context,
        householdId: String,
        memberId: String,
        memberName: String
    ): Long {
        require(householdId.isNotBlank())
        require(memberId.isNotBlank())
        require(memberName.isNotBlank())
        val prefs = getPrefs(context)
        val currentHouseholdId = prefs.getString(KEY_HOUSEHOLD_ID, "").orEmpty()
        val currentMemberId = prefs.getString(KEY_MEMBER_ID, "").orEmpty()
        val nextGeneration = if (
            currentHouseholdId == householdId && currentMemberId == memberId
        ) {
            prefs.getLong(KEY_SESSION_GENERATION, 0L).coerceAtLeast(1L)
        } else {
            nextSessionGeneration(prefs)
        }
        check(
            prefs.edit()
                .putString(KEY_HOUSEHOLD_ID, householdId)
                .putString(KEY_MEMBER_ID, memberId)
                .putString(KEY_MEMBER_NAME, memberName)
                .putLong(KEY_SESSION_GENERATION, nextGeneration)
                .commit()
        ) { "Native session mirror commit failed" }
        return nextGeneration
    }

    fun getMemberId(context: Context): String {
        return getPrefs(context).getString(KEY_MEMBER_ID, "") ?: ""
    }

    fun getSessionGeneration(context: Context): Long {
        return getPrefs(context).getLong(KEY_SESSION_GENERATION, 0L)
    }

    private fun nextSessionGeneration(preferences: SharedPreferences): Long {
        return preferences.getLong(KEY_SESSION_GENERATION, 0L) + 1L
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

    fun isQuickEditOverlayEnabled(context: Context): Boolean {
        return isQuickEditOverlayEnabled(
            context,
            getHouseholdKey(context),
            getMemberId(context)
        )
    }

    fun isQuickEditOverlayEnabled(
        context: Context,
        householdId: String,
        memberId: String
    ): Boolean {
        val key = getQuickEditOverlayKey(householdId, memberId) ?: return true
        val prefs = getPrefs(context)
        if (prefs.contains(key)) return prefs.getBoolean(key, true)

        // 기존 memberName 기반 설정은 안정적인 memberId 키로 한 번만 옮깁니다.
        val legacyKey = getQuickEditOverlayKey(householdId, getMemberName(context))
        if (legacyKey != null && prefs.contains(legacyKey)) {
            val migrated = prefs.getBoolean(legacyKey, true)
            prefs.edit().putBoolean(key, migrated).apply()
            return migrated
        }
        return true
    }

    fun setQuickEditOverlayEnabled(
        context: Context,
        householdId: String,
        memberId: String,
        enabled: Boolean
    ) {
        val key = getQuickEditOverlayKey(householdId, memberId) ?: return
        getPrefs(context).edit().putBoolean(key, enabled).apply()
    }

    private fun getQuickEditOverlayKey(householdId: String, memberId: String): String? {
        val normalizedHouseholdId = householdId.trim()
        val normalizedMemberId = memberId.trim()

        if (normalizedHouseholdId.isEmpty() || normalizedMemberId.isEmpty()) {
            return null
        }

        return "${KEY_QUICK_EDIT_OVERLAY_PREFIX}_${normalizedHouseholdId}_${normalizedMemberId}"
    }
}
