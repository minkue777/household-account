package com.household.account.notifications

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import com.household.account.service.FcmService
import com.household.account.util.HouseholdPreferences

/** 로그아웃 설치로 향하는 notification payload의 OS 자동 표시까지 차단하는 component gate입니다. */
object FcmServiceComponentGate {
    fun disableForLogout(context: Context): Boolean = runCatching {
        if (setEnabled(context, enabled = false)) {
            context.getSystemService(NotificationManager::class.java).cancelAll()
            true
        } else {
            false
        }
    }.getOrDefault(false)

    fun enableForRegistration(context: Context): Boolean = setEnabled(context, enabled = true)

    fun disableWhenNoLocalSession(context: Context) {
        if (
            HouseholdPreferences.getHouseholdKey(context).isBlank() ||
            HouseholdPreferences.getMemberId(context).isBlank()
        ) {
            disableForLogout(context)
        }
    }

    private fun setEnabled(context: Context, enabled: Boolean): Boolean = runCatching {
        context.packageManager.setComponentEnabledSetting(
            ComponentName(context, FcmService::class.java),
            if (enabled) {
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            } else {
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            },
            PackageManager.DONT_KILL_APP
        )
        true
    }.getOrDefault(false)
}
