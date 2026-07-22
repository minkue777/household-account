package com.household.account.notifications

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withTimeoutOrNull

enum class FidLogoutDetachmentStatus {
    SUCCEEDED,
    FAILED,
    TIMED_OUT,
    NOT_APPLICABLE
}

data class FidLogoutDetachmentResult(
    val localDeliveryGate: FidLogoutDetachmentStatus,
    val localSuppression: FidLogoutDetachmentStatus,
    val remoteRemoval: FidLogoutDetachmentStatus,
    val localUnregistration: FidLogoutDetachmentStatus
)

/** 원격 endpoint 삭제와 로컬 FCM 해제를 독립적으로, 같은 timeout 창에서 수행합니다. */
internal suspend fun detachFidForLogout(
    fid: String?,
    timeoutMillis: Long,
    disableLocalDelivery: () -> Boolean,
    persistLocalSuppression: () -> Unit,
    removeRemoteEndpoint: suspend (String) -> Boolean,
    unregisterLocalInstallation: suspend () -> Unit,
    clearLocalBindingIfCurrent: (String) -> Unit
): FidLogoutDetachmentResult = supervisorScope {
    require(timeoutMillis > 0L)
    val localDeliveryGate = try {
        if (disableLocalDelivery()) {
            FidLogoutDetachmentStatus.SUCCEEDED
        } else {
            FidLogoutDetachmentStatus.FAILED
        }
    } catch (_: Exception) {
        FidLogoutDetachmentStatus.FAILED
    }
    val localSuppression = try {
        persistLocalSuppression()
        FidLogoutDetachmentStatus.SUCCEEDED
    } catch (_: Exception) {
        // The component gate above is the primary background-delivery barrier. A
        // preference write failure must never skip the remaining detach attempts.
        FidLogoutDetachmentStatus.FAILED
    }

    val remote = async {
        val currentFid = fid
            ?: return@async FidLogoutDetachmentStatus.NOT_APPLICABLE
        withTimeoutOrNull(timeoutMillis) {
            try {
                if (removeRemoteEndpoint(currentFid)) {
                    clearLocalBindingIfCurrent(currentFid)
                    FidLogoutDetachmentStatus.SUCCEEDED
                } else {
                    FidLogoutDetachmentStatus.FAILED
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                FidLogoutDetachmentStatus.FAILED
            }
        } ?: FidLogoutDetachmentStatus.TIMED_OUT
    }
    val local = async {
        withTimeoutOrNull(timeoutMillis) {
            try {
                unregisterLocalInstallation()
                fid?.let(clearLocalBindingIfCurrent)
                FidLogoutDetachmentStatus.SUCCEEDED
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                FidLogoutDetachmentStatus.FAILED
            }
        } ?: FidLogoutDetachmentStatus.TIMED_OUT
    }

    FidLogoutDetachmentResult(
        localDeliveryGate = localDeliveryGate,
        localSuppression = localSuppression,
        remoteRemoval = remote.await(),
        localUnregistration = local.await()
    )
}

data class FidNotificationBinding(
    val householdId: String,
    val memberId: String,
    val registrationVersion: Int
)

internal fun canDisplayFidNotification(
    currentHouseholdId: String,
    currentMemberId: String,
    suppressedForLogout: Boolean,
    binding: FidNotificationBinding?
): Boolean =
    !suppressedForLogout &&
        currentHouseholdId.isNotBlank() &&
        currentMemberId.isNotBlank() &&
        binding != null &&
        binding.registrationVersion > 0 &&
        binding.householdId == currentHouseholdId &&
        binding.memberId == currentMemberId

enum class FidRegistrationStartStatus {
    STARTED,
    STALE_UNREGISTRATION_FAILED,
    COMPONENT_ENABLE_FAILED,
    REGISTRATION_FAILED
}

/** stale 수신 주소를 정리한 뒤에만 component를 열고 새 등록을 시작합니다. */
internal suspend fun startFidRegistration(
    staleCleanupRequired: Boolean,
    timeoutMillis: Long,
    unregisterStaleInstallation: suspend () -> Unit,
    enableLocalDelivery: () -> Boolean,
    registerInstallation: suspend () -> Unit,
    disableAfterFailure: () -> Unit
): FidRegistrationStartStatus {
    require(timeoutMillis > 0L)
    if (staleCleanupRequired) {
        val staleRemoved = withTimeoutOrNull(timeoutMillis) {
            try {
                unregisterStaleInstallation()
                true
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                false
            }
        } ?: false
        if (!staleRemoved) {
            runCatching(disableAfterFailure)
            return FidRegistrationStartStatus.STALE_UNREGISTRATION_FAILED
        }
    }

    if (!runCatching(enableLocalDelivery).getOrDefault(false)) {
        runCatching(disableAfterFailure)
        return FidRegistrationStartStatus.COMPONENT_ENABLE_FAILED
    }
    return try {
        registerInstallation()
        FidRegistrationStartStatus.STARTED
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        runCatching(disableAfterFailure)
        FidRegistrationStartStatus.REGISTRATION_FAILED
    }
}
