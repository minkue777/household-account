package com.household.account

import android.app.Application
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.household.account.quickedit.QuickEditCommandDelivery
import com.household.account.startup.ApplicationStartupTasks
import com.household.account.util.FidEndpointManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Callable 요청 전에 Play Integrity 기반 Firebase App Check를 설치합니다. */
class HouseholdAccountApplication : Application() {
    private val startupScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            PlayIntegrityAppCheckProviderFactory.getInstance()
        )
        ApplicationStartupTasks(
            scope = startupScope,
            quickEditRecoveryDelayMillis = QUICK_EDIT_RECOVERY_DELAY_MILLIS,
            enforceFcmDeliveryGate = {
                FidEndpointManager.enforceDeliveryGateForCurrentSession(applicationContext)
            },
            resumeQuickEditOutbox = {
                QuickEditCommandDelivery.resumePending(applicationContext)
            }
        ).schedule()
    }

    private companion object {
        const val QUICK_EDIT_RECOVERY_DELAY_MILLIS = 1_000L
    }
}
