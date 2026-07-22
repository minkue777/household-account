package com.household.account.auth

import android.app.Activity
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.household.account.BuildConfig
import com.household.account.paymentcapture.AndroidCaptureDelivery
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.session.NativeMembershipResolution
import com.household.account.session.NativeMembershipResolver
import com.household.account.util.FidEndpointManager
import com.household.account.util.HouseholdPreferences
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.tasks.await

sealed interface NativeAuthResult {
    data class SignedIn(
        val customToken: String,
        val principalUid: String? = null,
        val signedInUserResolution: Map<String, Any?>? = null
    ) : NativeAuthResult
    data object SignedOut : NativeAuthResult
    data class Rejected(val code: String) : NativeAuthResult
}

class NativeAuthCoordinator(
    private val activity: Activity,
    private val firebaseAuth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val credentialManager: CredentialManager = CredentialManager.create(activity),
    private val callableGateway: FirebaseAuthenticatedCallableGateway =
        FirebaseAuthenticatedCallableGateway()
) {
    @Volatile
    private var bootstrappedMembership: NativeMembershipResolution.Ready? = null
    private val sessionPrewarmer = SingleUseSessionPrewarmer<NativeAuthResult>()

    /**
     * 이미 복원된 Native Firebase principal만 세션 교환을 미리 시작합니다.
     * currentUser가 없으면 Credential Manager를 열지 않고 아무 일도 하지 않습니다.
     */
    fun prewarmSignedInSession(scope: CoroutineScope) {
        if (firebaseAuth.currentUser == null) return
        sessionPrewarmer.prepare(scope) { exchangeCurrentSignedInSession() }
    }

    suspend fun signIn(): NativeAuthResult {
        return sessionPrewarmer.consumeOr { signInAndExchange() }
    }

    private suspend fun signInAndExchange(): NativeAuthResult {
        if (firebaseAuth.currentUser == null) {
            val webClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID.trim()
            if (webClientId.isEmpty()) {
                return NativeAuthResult.Rejected("GOOGLE_WEB_CLIENT_ID_REQUIRED")
            }
            val idToken = try {
                googleIdToken(webClientId, filterAuthorizedAccounts = true)
            } catch (_: NoCredentialException) {
                try {
                    googleIdToken(webClientId, filterAuthorizedAccounts = false)
                } catch (_: GetCredentialCancellationException) {
                    return NativeAuthResult.Rejected("SIGN_IN_CANCELLED")
                } catch (_: Exception) {
                    return NativeAuthResult.Rejected("GOOGLE_CREDENTIAL_FAILED")
                }
            } catch (_: GetCredentialCancellationException) {
                return NativeAuthResult.Rejected("SIGN_IN_CANCELLED")
            } catch (_: Exception) {
                return NativeAuthResult.Rejected("GOOGLE_CREDENTIAL_FAILED")
            }

            try {
                val firebaseCredential = GoogleAuthProvider.getCredential(idToken, null)
                firebaseAuth.signInWithCredential(firebaseCredential).await()
            } catch (_: Exception) {
                return NativeAuthResult.Rejected("FIREBASE_SIGN_IN_FAILED")
            }
        }

        return exchangeCurrentSignedInSession()
    }

    private suspend fun exchangeCurrentSignedInSession(): NativeAuthResult {
        if (firebaseAuth.currentUser == null) {
            return NativeAuthResult.Rejected("NATIVE_AUTH_REQUIRED")
        }
        val response = try {
            callableGateway.call(WEBVIEW_SESSION_FUNCTION, emptyMap())
        } catch (_: Exception) {
            return NativeAuthResult.Rejected("WEBVIEW_SESSION_TOKEN_FAILED")
        }
        if (response["contractVersion"] != WEBVIEW_SESSION_CONTRACT) {
            return NativeAuthResult.Rejected("WEBVIEW_SESSION_CONTRACT_INVALID")
        }
        val customToken = response["customToken"]?.toString().orEmpty()
        if (customToken.isBlank()) {
            return NativeAuthResult.Rejected("WEBVIEW_SESSION_TOKEN_INVALID")
        }

        val principalUid = response["principalUid"]?.toString()
        val rawResolution = response["signedInUserResolution"]
        if (principalUid == null && rawResolution == null) {
            // 구버전 Function과의 롤링 배포 호환: Web이 기존 Membership Command로 fallback합니다.
            bootstrappedMembership = null
            return NativeAuthResult.SignedIn(customToken)
        }
        val resolution = stringKeyedMap(rawResolution)
        if (
            principalUid.isNullOrBlank() ||
            principalUid != firebaseAuth.currentUser?.uid ||
            resolution == null
        ) {
            return NativeAuthResult.Rejected("WEBVIEW_SESSION_MEMBERSHIP_INVALID")
        }
        when (
            val nativeResolution = NativeMembershipResolver.acceptAuthoritative(
                activity.applicationContext,
                resolution
            )
        ) {
            is NativeMembershipResolution.Ready -> bootstrappedMembership = nativeResolution
            NativeMembershipResolution.FirstVisit -> bootstrappedMembership = null
            is NativeMembershipResolution.Failed ->
                return NativeAuthResult.Rejected(nativeResolution.code)
        }
        return NativeAuthResult.SignedIn(customToken, principalUid, resolution)
    }

    suspend fun signOut(): NativeAuthResult {
        val context = activity.applicationContext
        val householdId = HouseholdPreferences.getHouseholdKey(context)
        val memberId = HouseholdPreferences.getMemberId(context)
        sessionPrewarmer.clear()

        // 원격 endpoint 삭제가 실패해도 FcmService component를 먼저 끄고 로컬
        // unregister를 별도로 시도하여 로그아웃 설치의 OS 자동 표시 경로를 닫습니다.
        try {
            FidEndpointManager.detachCurrentInstallationForLogout(
                context,
                householdId,
                memberId
            )
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // component gate 실패를 포함한 로컬 FCM 오류가 로그아웃 자체를 막지 않는다.
        }

        try {
            AndroidCaptureDelivery.purgeForSessionTransition(context)
        } finally {
            HouseholdPreferences.clearHouseholdKey(context)
            bootstrappedMembership = null
            firebaseAuth.signOut()
            runCatching {
                credentialManager.clearCredentialState(ClearCredentialStateRequest())
            }
        }
        return NativeAuthResult.SignedOut
    }

    suspend fun refreshMembership(): NativeMembershipResolution {
        val bootstrapped = bootstrappedMembership
        bootstrappedMembership = null
        return bootstrapped ?: NativeMembershipResolver.refresh(activity.applicationContext)
    }

    private suspend fun googleIdToken(
        webClientId: String,
        filterAuthorizedAccounts: Boolean
    ): String {
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(webClientId)
            .setFilterByAuthorizedAccounts(filterAuthorizedAccounts)
            .setAutoSelectEnabled(filterAuthorizedAccounts)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build()
        val credential = credentialManager.getCredential(
            context = activity,
            request = request
        ).credential
        require(
            credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        )
        return GoogleIdTokenCredential.createFrom(credential.data).idToken
    }

    private fun stringKeyedMap(value: Any?): Map<String, Any?>? {
        val raw = value as? Map<*, *> ?: return null
        if (raw.keys.any { it !is String }) return null
        return raw.entries.associate { (key, entryValue) -> key as String to entryValue }
    }

    companion object {
        const val WEBVIEW_SESSION_FUNCTION = "createWebViewSessionToken"
        const val WEBVIEW_SESSION_CONTRACT = "webview-session-token.v1"
    }
}
