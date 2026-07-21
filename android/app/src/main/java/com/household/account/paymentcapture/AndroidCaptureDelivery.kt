package com.household.account.paymentcapture

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.household.account.quickedit.QuickEditCoordinator
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.session.NativeMembershipResolution
import com.household.account.session.NativeMembershipResolver
import com.household.account.util.HouseholdPreferences
import java.util.concurrent.TimeUnit

object AndroidCaptureDelivery {
    @Volatile
    private var queueInstance: CaptureDeliveryQueue? = null

    private fun queue(context: Context): CaptureDeliveryQueue =
        queueInstance ?: synchronized(this) {
            queueInstance ?: CaptureDeliveryQueue(
                AndroidKeystoreCaptureQueueStore(context.applicationContext)
            ).also { queueInstance = it }
        }

    suspend fun enqueueAndFlush(
        context: Context,
        envelope: CaptureDeliveryEnvelope
    ): CaptureFlushOutcome? {
        val scope = resolveScope(context)
        if (!queue(context).enqueue(scope, envelope)) return null

        scheduleRetry(context)
        return flush(context)
    }

    suspend fun flush(context: Context): CaptureFlushOutcome {
        val outcome = queue(context).flush(
            currentScope = resolveScope(context),
            client = CallableCaptureSubmissionClient(FirebaseAuthenticatedCallableGateway())
        )
        deliverFollowUps(context, outcome.followUps)
        return outcome
    }

    suspend fun purgeForSessionTransition(context: Context) {
        queue(context).purgeForSessionTransition()
        QuickEditCoordinator.purgeForSessionTransition(context)
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    fun scheduleRetry(context: Context) {
        val request = OneTimeWorkRequestBuilder<CaptureDeliveryWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    private fun currentScope(context: Context) = CaptureSessionScope(
        householdId = HouseholdPreferences.getHouseholdKey(context),
        memberId = HouseholdPreferences.getMemberId(context),
        sessionGeneration = HouseholdPreferences.getSessionGeneration(context)
    )

    private suspend fun resolveScope(context: Context): CaptureSessionScope {
        val current = currentScope(context)
        if (current.isUsable) return current
        return when (val resolution = NativeMembershipResolver.refresh(context.applicationContext)) {
            is NativeMembershipResolution.Ready -> resolution.scope
            else -> current
        }
    }

    private suspend fun deliverFollowUps(
        context: Context,
        followUps: List<CaptureDeliveryFollowUp>
    ) {
        followUps.forEach { followUp ->
            QuickEditCoordinator.enqueueAndPresent(context, followUp)
        }
    }

    private const val WORK_NAME = "capture-envelope-delivery.v1"
}
