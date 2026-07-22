package com.household.account.util

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessaging
import com.household.account.ledger.CallableHouseholdCommandClient
import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.ledger.HouseholdCommandResult
import com.household.account.notifications.AndroidEndpointDeviceInfo
import com.household.account.notifications.FcmServiceComponentGate
import com.household.account.notifications.FidLogoutDetachmentResult
import com.household.account.notifications.FidNotificationBinding
import com.household.account.notifications.FidEndpointCommandPayloads
import com.household.account.notifications.canDisplayFidNotification
import com.household.account.notifications.detachFidForLogout
import com.household.account.notifications.startFidRegistration
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/** FCM이 등록 완료한 FID를 현재 인증 Membership에 연결하는 Android endpoint Adapter입니다. */
object FidEndpointManager {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun registerCurrentInstallation(context: Context) {
        val householdId = HouseholdPreferences.getHouseholdKey(context)
        val memberId = HouseholdPreferences.getMemberId(context)
        if (householdId.isBlank() || memberId.isBlank()) return
        val appContext = context.applicationContext
        scope.launch {
            val before = FidRegistrationStateStore.current(appContext)
            val staleCleanupRequired =
                FidRegistrationStateStore.notificationsSuppressed(appContext) ||
                    before?.let {
                        it.householdId != householdId || it.memberId != memberId
                    } == true
            val staleFid = before?.fid
            startFidRegistration(
                staleCleanupRequired = staleCleanupRequired,
                timeoutMillis = LOGOUT_DETACH_TIMEOUT_MILLIS,
                unregisterStaleInstallation = {
                    FirebaseMessaging.getInstance().unregister().await()
                    staleFid?.let {
                        FidRegistrationStateStore.clearIfCurrent(appContext, it)
                    }
                },
                enableLocalDelivery = {
                    FcmServiceComponentGate.enableForRegistration(appContext)
                },
                registerInstallation = {
                    // 성공하면 FcmService.onRegistered(fid)가 호출됩니다.
                    FirebaseMessaging.getInstance().register().await()
                },
                disableAfterFailure = {
                    FidRegistrationStateStore.suppressNotifications(appContext)
                    FcmServiceComponentGate.disableForLogout(appContext)
                }
            )
        }
    }

    fun onRegistered(context: Context, fid: String) {
        if (fid.isBlank()) return
        val appContext = context.applicationContext
        FidRegistrationStateStore.observe(appContext, fid)
        val householdId = HouseholdPreferences.getHouseholdKey(appContext)
        val memberId = HouseholdPreferences.getMemberId(appContext)
        val sessionGeneration = HouseholdPreferences.getSessionGeneration(appContext)
        if (householdId.isBlank() || memberId.isBlank()) return

        scope.launch {
            val result = execute(
                householdId = householdId,
                command = HouseholdCommandKind.REGISTER_NOTIFICATION_ENDPOINT,
                payload = FidEndpointCommandPayloads.registration(
                    fid,
                    AndroidEndpointDeviceInfo(
                        model = Build.MODEL,
                        osVersion = Build.VERSION.RELEASE,
                        sdkVersion = Build.VERSION.SDK_INT.toString(),
                        appVersion = appVersion(appContext)
                    )
                )
            )
            if (
                result is HouseholdCommandResult.Succeeded &&
                sessionIsStillCurrent(appContext, householdId, memberId, sessionGeneration)
            ) {
                result.registrationVersion()?.let { version ->
                    FidRegistrationStateStore.confirm(
                        appContext,
                        fid,
                        version,
                        householdId,
                        memberId
                    )
                }
            } else if (
                sessionIsStillCurrent(appContext, householdId, memberId, sessionGeneration)
            ) {
                FidRegistrationStateStore.suppressNotifications(appContext)
                FcmServiceComponentGate.disableForLogout(appContext)
            }
        }
    }

    fun onUnregistered(context: Context, fid: String) {
        if (fid.isBlank()) return
        val appContext = context.applicationContext
        val state = FidRegistrationStateStore.current(appContext)
        if (state?.fid != fid || state.registrationVersion == null) return
        val householdId = HouseholdPreferences.getHouseholdKey(appContext)
        val memberId = HouseholdPreferences.getMemberId(appContext)
        if (householdId.isBlank() || memberId.isBlank()) return

        scope.launch {
            val result = execute(
                householdId = householdId,
                command = HouseholdCommandKind.REMOVE_NOTIFICATION_ENDPOINT,
                payload = FidEndpointCommandPayloads.sdkUnregistered(
                    fid,
                    state.registrationVersion
                )
            )
            if (result is HouseholdCommandResult.Succeeded) {
                FidRegistrationStateStore.clearIfCurrent(appContext, fid)
            }
        }
    }

    suspend fun removeCurrentInstallation(
        context: Context,
        householdId: String,
        memberId: String
    ): HouseholdCommandResult {
        if (householdId.isBlank() || memberId.isBlank()) {
            return HouseholdCommandResult.Rejected("HOUSEHOLD_SESSION_REQUIRED")
        }
        val appContext = context.applicationContext
        val fid = FidRegistrationStateStore.current(appContext)?.fid
            ?: return HouseholdCommandResult.Succeeded(mapOf("kind" to "already-absent"))
        val result = execute(
            householdId = householdId,
            command = HouseholdCommandKind.REMOVE_NOTIFICATION_ENDPOINT,
            payload = FidEndpointCommandPayloads.logout(fid)
        )
        if (result is HouseholdCommandResult.Succeeded) {
            FidRegistrationStateStore.clearIfCurrent(appContext, fid)
        }
        return result
    }

    /**
     * 서버 삭제와 FCM unregister를 병렬 best-effort로 수행합니다. 그 전에 FcmService
     * component를 끄므로 두 네트워크 작업이 모두 실패해도 OS 자동 표시 경로는 닫힙니다.
     */
    suspend fun detachCurrentInstallationForLogout(
        context: Context,
        householdId: String,
        memberId: String
    ): FidLogoutDetachmentResult {
        val appContext = context.applicationContext
        val fid = FidRegistrationStateStore.current(appContext)?.fid
        return detachFidForLogout(
            fid = fid,
            timeoutMillis = LOGOUT_DETACH_TIMEOUT_MILLIS,
            disableLocalDelivery = {
                FcmServiceComponentGate.disableForLogout(appContext)
            },
            persistLocalSuppression = {
                FidRegistrationStateStore.suppressNotifications(appContext)
            },
            removeRemoteEndpoint = { capturedFid ->
                if (householdId.isBlank() || memberId.isBlank()) {
                    false
                } else {
                    execute(
                        householdId = householdId,
                        command = HouseholdCommandKind.REMOVE_NOTIFICATION_ENDPOINT,
                        payload = FidEndpointCommandPayloads.logout(capturedFid)
                    ) is HouseholdCommandResult.Succeeded
                }
            },
            unregisterLocalInstallation = {
                FirebaseMessaging.getInstance().unregister().await()
            },
            clearLocalBindingIfCurrent = { capturedFid ->
                FidRegistrationStateStore.clearIfCurrent(appContext, capturedFid)
            }
        )
    }

    fun shouldDisplayIncomingNotification(context: Context): Boolean {
        val appContext = context.applicationContext
        val state = FidRegistrationStateStore.current(appContext)
        val binding = if (
            state?.registrationVersion != null &&
            !state.householdId.isNullOrBlank() &&
            !state.memberId.isNullOrBlank()
        ) {
            FidNotificationBinding(
                householdId = state.householdId,
                memberId = state.memberId,
                registrationVersion = state.registrationVersion
            )
        } else {
            null
        }
        return canDisplayFidNotification(
            currentHouseholdId = HouseholdPreferences.getHouseholdKey(appContext),
            currentMemberId = HouseholdPreferences.getMemberId(appContext),
            suppressedForLogout = FidRegistrationStateStore.notificationsSuppressed(
                appContext
            ),
            binding = binding
        )
    }

    fun enforceDeliveryGateForCurrentSession(context: Context) {
        FcmServiceComponentGate.disableWhenNoLocalSession(context.applicationContext)
    }

    private suspend fun execute(
        householdId: String,
        command: HouseholdCommandKind,
        payload: Map<String, Any?>
    ): HouseholdCommandResult {
        val envelope = HouseholdCommandEnvelopeV1.create(
            householdId = householdId,
            command = command,
            payload = payload,
            // 정기 onRegistered callback마다 서버 last-confirmed 시각을 갱신해야 하므로
            // 서로 다른 callback을 같은 idempotency receipt로 합치지 않습니다.
            operationId = UUID.randomUUID().toString()
        )
        return CallableHouseholdCommandClient(FirebaseAuthenticatedCallableGateway()).execute(envelope)
    }

    private fun sessionIsStillCurrent(
        context: Context,
        householdId: String,
        memberId: String,
        sessionGeneration: Long
    ): Boolean =
        HouseholdPreferences.getHouseholdKey(context) == householdId &&
            HouseholdPreferences.getMemberId(context) == memberId &&
            HouseholdPreferences.getSessionGeneration(context) == sessionGeneration

    private fun HouseholdCommandResult.Succeeded.registrationVersion(): Int? =
        ((value as? Map<*, *>)?.get("registrationVersion") as? Number)?.toInt()

    private fun appVersion(context: Context): String = try {
        val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageInfo(
                context.packageName,
                PackageManager.PackageInfoFlags.of(0)
            )
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0)
        }
        packageInfo.versionName.orEmpty()
    } catch (_: Exception) {
        ""
    }

    private const val LOGOUT_DETACH_TIMEOUT_MILLIS = 3_000L
}

private data class FidRegistrationState(
    val fid: String,
    val registrationVersion: Int?,
    val householdId: String?,
    val memberId: String?
)

private object FidRegistrationStateStore {
    private const val PREFERENCES = "fcm_fid_registration_state"
    private const val KEY_FID = "fid"
    private const val KEY_REGISTRATION_VERSION = "registrationVersion"
    private const val KEY_HOUSEHOLD_ID = "householdId"
    private const val KEY_MEMBER_ID = "memberId"
    private const val KEY_NOTIFICATIONS_SUPPRESSED = "notificationsSuppressed"

    fun observe(context: Context, fid: String) {
        val current = current(context)
        val editor = preferences(context).edit().putString(KEY_FID, fid)
        if (current?.fid != fid) {
            editor
                .remove(KEY_REGISTRATION_VERSION)
                .remove(KEY_HOUSEHOLD_ID)
                .remove(KEY_MEMBER_ID)
        }
        editor.apply()
    }

    fun confirm(
        context: Context,
        fid: String,
        registrationVersion: Int,
        householdId: String,
        memberId: String
    ) {
        if (current(context)?.fid != fid || registrationVersion <= 0) return
        if (householdId.isBlank() || memberId.isBlank()) return
        check(
            preferences(context).edit()
                .putInt(KEY_REGISTRATION_VERSION, registrationVersion)
                .putString(KEY_HOUSEHOLD_ID, householdId)
                .putString(KEY_MEMBER_ID, memberId)
                .putBoolean(KEY_NOTIFICATIONS_SUPPRESSED, false)
                .commit()
        ) { "FID notification binding commit failed" }
    }

    fun current(context: Context): FidRegistrationState? {
        val preferences = preferences(context)
        val fid = preferences.getString(KEY_FID, "").orEmpty()
        if (fid.isBlank()) return null
        val version = if (preferences.contains(KEY_REGISTRATION_VERSION)) {
            preferences.getInt(KEY_REGISTRATION_VERSION, 0).takeIf { it > 0 }
        } else {
            null
        }
        return FidRegistrationState(
            fid = fid,
            registrationVersion = version,
            householdId = preferences.getString(KEY_HOUSEHOLD_ID, null),
            memberId = preferences.getString(KEY_MEMBER_ID, null)
        )
    }

    fun suppressNotifications(context: Context) {
        check(
            preferences(context).edit()
                .putBoolean(KEY_NOTIFICATIONS_SUPPRESSED, true)
                .commit()
        ) { "FID notification suppression commit failed" }
    }

    fun notificationsSuppressed(context: Context): Boolean =
        preferences(context).getBoolean(KEY_NOTIFICATIONS_SUPPRESSED, false)

    fun clearIfCurrent(context: Context, fid: String) {
        if (current(context)?.fid != fid) return
        preferences(context).edit().clear().apply()
    }

    private fun preferences(context: Context) =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
}
