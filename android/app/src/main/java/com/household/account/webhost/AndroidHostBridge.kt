package com.household.account.webhost

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import com.household.account.auth.NativeAuthCoordinator
import com.household.account.auth.NativeAuthResult
import com.household.account.paymentcapture.AndroidCaptureDelivery
import com.household.account.session.NativeMembershipResolution
import com.household.account.util.FidEndpointManager
import com.household.account.util.HouseholdPreferences
import org.json.JSONObject

/** 정확한 허용 origin에서만 노출되는 versioned Android host contract입니다. */
class AndroidHostBridge(
    private val context: Activity,
    private val authCoordinator: NativeAuthCoordinator = NativeAuthCoordinator(context)
) {
    suspend fun handle(rawMessage: String): String {
        val request = runCatching { JSONObject(rawMessage) }.getOrNull()
            ?: return rejected("invalid-request", "INVALID_JSON")
        val requestId = request.optString("requestId")
        if (request.optString("contractVersion") != REQUEST_VERSION || requestId.isBlank()) {
            return rejected(requestId.ifBlank { "invalid-request" }, "INVALID_CONTRACT")
        }
        val payload = request.optJSONObject("payload")
            ?: return rejected(requestId, "PAYLOAD_REQUIRED")

        return when (request.optString("operation")) {
            "app.get-version" -> succeeded(
                requestId,
                JSONObject().put("version", appVersion() ?: JSONObject.NULL)
            )
            "quick-edit.get-overlay-enabled" -> scoped(requestId, payload) { householdId, memberId ->
                JSONObject().put(
                    "enabled",
                    HouseholdPreferences.isQuickEditOverlayEnabled(context, householdId, memberId)
                )
            }
            "quick-edit.set-overlay-enabled" -> scoped(requestId, payload) { householdId, memberId ->
                if (!payload.has("enabled")) return@scoped null
                HouseholdPreferences.setQuickEditOverlayEnabled(
                    context,
                    householdId,
                    memberId,
                    payload.getBoolean("enabled")
                )
                JSONObject()
            }
            "auth.sign-in" -> when (val result = authCoordinator.signIn()) {
                is NativeAuthResult.SignedIn -> succeeded(
                    requestId,
                    JSONObject().put("customToken", result.customToken)
                )
                is NativeAuthResult.Rejected -> rejected(requestId, result.code)
                NativeAuthResult.SignedOut -> rejected(requestId, "AUTH_RESULT_INVALID")
            }
            "auth.sign-out" -> when (val result = authCoordinator.signOut()) {
                NativeAuthResult.SignedOut -> succeeded(requestId, JSONObject())
                is NativeAuthResult.Rejected -> rejected(requestId, result.code)
                is NativeAuthResult.SignedIn -> rejected(requestId, "AUTH_RESULT_INVALID")
            }
            "session.refresh" -> when (val result = authCoordinator.refreshMembership()) {
                is NativeMembershipResolution.Ready -> {
                    FidEndpointManager.registerCurrentInstallation(context.applicationContext)
                    AndroidCaptureDelivery.scheduleRetry(context.applicationContext)
                    succeeded(
                        requestId,
                        JSONObject()
                            .put("householdId", result.scope.householdId)
                            .put("memberId", result.scope.memberId)
                            .put("sessionGeneration", result.scope.sessionGeneration)
                    )
                }
                NativeMembershipResolution.FirstVisit -> rejected(requestId, "FIRST_VISIT_REQUIRED")
                is NativeMembershipResolution.Failed -> rejected(requestId, result.code)
            }
            else -> rejected(requestId, "UNKNOWN_OPERATION")
        }
    }

    private fun scoped(
        requestId: String,
        payload: JSONObject,
        block: (householdId: String, memberId: String) -> JSONObject?
    ): String {
        val householdId = payload.optString("householdId")
        val memberId = payload.optString("memberId")
        if (
            householdId.isBlank() || memberId.isBlank() ||
            HouseholdPreferences.getHouseholdKey(context) != householdId ||
            HouseholdPreferences.getMemberId(context) != memberId
        ) {
            return rejected(requestId, "SESSION_SCOPE_MISMATCH")
        }
        val value = runCatching { block(householdId, memberId) }.getOrNull()
            ?: return rejected(requestId, "INVALID_PAYLOAD")
        return succeeded(requestId, value)
    }

    private fun succeeded(requestId: String, value: JSONObject): String = JSONObject()
        .put("contractVersion", RESPONSE_VERSION)
        .put("requestId", requestId)
        .put(
            "result",
            JSONObject().put("kind", "succeeded").put("value", value)
        )
        .toString()

    private fun rejected(requestId: String, code: String): String = JSONObject()
        .put("contractVersion", RESPONSE_VERSION)
        .put("requestId", requestId)
        .put(
            "result",
            JSONObject().put("kind", "rejected").put(
                "error",
                JSONObject().put("code", code)
            )
        )
        .toString()

    private fun appVersion(): String? = try {
        val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageInfo(
                context.packageName,
                PackageManager.PackageInfoFlags.of(0)
            )
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0)
        }
        packageInfo.versionName
    } catch (_: Exception) {
        null
    }

    companion object {
        const val OBJECT_NAME = "HouseholdNativeBridge"
        const val REQUEST_VERSION = "android-bridge.v1"
        const val RESPONSE_VERSION = "android-bridge-response.v1"
    }
}
