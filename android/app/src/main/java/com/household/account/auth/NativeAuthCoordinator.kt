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
import com.household.account.ledger.HouseholdCommandResult
import com.household.account.paymentcapture.AndroidCaptureDelivery
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.session.NativeMembershipResolution
import com.household.account.session.NativeMembershipResolver
import com.household.account.util.FidEndpointManager
import com.household.account.util.HouseholdPreferences
import kotlinx.coroutines.tasks.await

sealed interface NativeAuthResult {
    data class SignedIn(val customToken: String) : NativeAuthResult
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
    suspend fun signIn(): NativeAuthResult {
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

        // 기존 사용자는 즉시 native queue scope를 복구합니다. 첫 방문은 Web create/join 뒤
        // session.refresh가 같은 서버 조회를 다시 실행합니다.
        NativeMembershipResolver.refresh(activity.applicationContext)

        val response = try {
            callableGateway.call(WEBVIEW_SESSION_FUNCTION, emptyMap())
        } catch (_: Exception) {
            return NativeAuthResult.Rejected("WEBVIEW_SESSION_TOKEN_FAILED")
        }
        if (response["contractVersion"] != WEBVIEW_SESSION_CONTRACT) {
            return NativeAuthResult.Rejected("WEBVIEW_SESSION_CONTRACT_INVALID")
        }
        val customToken = response["customToken"]?.toString().orEmpty()
        return if (customToken.isBlank()) {
            NativeAuthResult.Rejected("WEBVIEW_SESSION_TOKEN_INVALID")
        } else {
            NativeAuthResult.SignedIn(customToken)
        }
    }

    suspend fun signOut(): NativeAuthResult {
        val context = activity.applicationContext
        val householdId = HouseholdPreferences.getHouseholdKey(context)
        val memberId = HouseholdPreferences.getMemberId(context)
        val endpointResult = if (householdId.isNotBlank() && memberId.isNotBlank()) {
            FidEndpointManager.removeCurrentInstallation(context, householdId, memberId)
        } else {
            HouseholdCommandResult.Succeeded(mapOf("kind" to "already-absent"))
        }
        if (endpointResult !is HouseholdCommandResult.Succeeded) {
            return NativeAuthResult.Rejected("ENDPOINT_REMOVAL_FAILED")
        }

        AndroidCaptureDelivery.purgeForSessionTransition(context)
        HouseholdPreferences.clearHouseholdKey(context)
        firebaseAuth.signOut()
        runCatching {
            credentialManager.clearCredentialState(ClearCredentialStateRequest())
        }
        return NativeAuthResult.SignedOut
    }

    suspend fun refreshMembership(): NativeMembershipResolution =
        NativeMembershipResolver.refresh(activity.applicationContext)

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

    companion object {
        const val WEBVIEW_SESSION_FUNCTION = "createWebViewSessionToken"
        const val WEBVIEW_SESSION_CONTRACT = "webview-session-token.v1"
    }
}
