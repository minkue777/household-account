package com.household.account.session

import android.content.Context
import com.household.account.ledger.CallableHouseholdCommandClient
import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.ledger.HouseholdCommandResult
import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.util.HouseholdPreferences
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

sealed interface NativeMembershipResolution {
    data class Ready(val scope: CaptureSessionScope) : NativeMembershipResolution
    data object FirstVisit : NativeMembershipResolution
    data class Failed(val code: String, val retryable: Boolean) : NativeMembershipResolution
}

/** native Firebase principal에서만 Membership을 다시 해석하며 Web이 tenant ID를 주입하지 못하게 합니다. */
object NativeMembershipResolver {
    private val mutex = Mutex()

    suspend fun refresh(context: Context): NativeMembershipResolution = mutex.withLock {
        val result = CallableHouseholdCommandClient(
            FirebaseAuthenticatedCallableGateway()
        ).execute(
            HouseholdCommandEnvelopeV1.createPrincipal(
                command = HouseholdCommandKind.RESOLVE_SIGNED_IN_USER,
                operationId = UUID.randomUUID().toString()
            )
        )

        when (result) {
            is HouseholdCommandResult.Succeeded -> decodeAndPersist(context, result.value)
            is HouseholdCommandResult.RetryableFailure ->
                NativeMembershipResolution.Failed(result.code, retryable = true)
            is HouseholdCommandResult.Rejected ->
                NativeMembershipResolution.Failed(result.code, retryable = false)
            is HouseholdCommandResult.Conflict ->
                NativeMembershipResolution.Failed("MEMBERSHIP_CONFLICT", retryable = false)
            is HouseholdCommandResult.ContractFailure ->
                NativeMembershipResolution.Failed(result.code, retryable = false)
        }
    }

    private fun decodeAndPersist(context: Context, rawValue: Any?): NativeMembershipResolution {
        val value = rawValue as? Map<*, *>
            ?: return NativeMembershipResolution.Failed("MEMBERSHIP_RESPONSE_INVALID", false)
        return when (value["kind"]?.toString()) {
            "first-visit-required" -> NativeMembershipResolution.FirstVisit
            "membership-found" -> {
                val membership = value["membership"] as? Map<*, *>
                    ?: return NativeMembershipResolution.Failed("MEMBERSHIP_RESPONSE_INVALID", false)
                val householdId = membership["householdId"]?.toString().orEmpty()
                val memberId = membership["memberId"]?.toString().orEmpty()
                val displayName = membership["displayName"]?.toString().orEmpty()
                if (householdId.isBlank() || memberId.isBlank() || displayName.isBlank()) {
                    return NativeMembershipResolution.Failed("MEMBERSHIP_RESPONSE_INVALID", false)
                }
                val generation = HouseholdPreferences.replaceAuthenticatedSession(
                    context.applicationContext,
                    householdId,
                    memberId,
                    displayName
                )
                NativeMembershipResolution.Ready(
                    CaptureSessionScope(householdId, memberId, generation)
                )
            }
            else -> NativeMembershipResolution.Failed("MEMBERSHIP_RESPONSE_INVALID", false)
        }
    }
}
