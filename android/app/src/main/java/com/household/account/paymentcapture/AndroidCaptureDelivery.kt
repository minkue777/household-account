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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

object AndroidCaptureDelivery {
    @Volatile
    private var queueInstance: CaptureDeliveryQueue? = null
    private val retryWorkScheduler = CaptureRetryWorkScheduler(
        CoroutineScope(SupervisorJob() + Dispatchers.IO)
    )

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
        if (!scope.isUsable) return null
        // 원격 호출 중 process가 종료되어도 알림이 유실되지 않도록 먼저 암호화
        // journal에 기록합니다. 정상 경로에서는 WorkManager를 예약하지 않고 즉시 호출합니다.
        if (!queue(context).enqueue(scope, envelope)) return null
        AndroidCaptureLatencyTelemetry.mark(
            observationId = envelope.observationId,
            stage = CaptureLatencyStage.JOURNAL_PERSISTED
        )
        val receipt = try {
            submissionClient().submit(envelope)
        } catch (_: Exception) {
            scheduleRetry(context)
            return CaptureFlushOutcome(emptyList(), retainedCount = 1)
        }

        val decision = evaluateCaptureReceipt(envelope, receipt)
        try {
            enqueueFollowUps(context, scope, decision.followUps)
        } catch (_: Exception) {
            scheduleRetry(context)
            return CaptureFlushOutcome(emptyList(), retainedCount = 1)
        }
        val retainedCount = if (decision.completed) {
            if (!queue(context).completeAfterAttempt(scope, envelope)) return null
            0
        } else {
            if (
                !queue(context).retainAfterAttempt(
                    scope = scope,
                    envelope = envelope,
                    terminalBranches = decision.terminalBranches
                )
            ) return null
            1
        }
        if (retainedCount > 0) scheduleRetry(context)
        return CaptureFlushOutcome(decision.followUps, retainedCount)
    }

    suspend fun enqueueBatchAndFlush(
        context: Context,
        envelopes: List<CaptureDeliveryEnvelope>
    ): CaptureFlushOutcome? {
        if (envelopes.isEmpty()) return null
        val scope = resolveScope(context)
        if (!scope.isUsable) return null

        val outcome = try {
            enqueueAndSubmitCaptureBatch(
                queue = queue(context),
                scope = scope,
                envelopes = envelopes,
                client = submissionClient(),
                afterJournalPersisted = { persisted ->
                    persisted.forEach { envelope ->
                        AndroidCaptureLatencyTelemetry.mark(
                            observationId = envelope.observationId,
                            stage = CaptureLatencyStage.JOURNAL_PERSISTED
                        )
                    }
                },
                beforeCommitFollowUps = { followUps ->
                    enqueueFollowUps(context, scope, followUps)
                }
            )
        } catch (_: Exception) {
            scheduleRetry(context)
            return CaptureFlushOutcome(
                followUps = emptyList(),
                retainedCount = queue(context).snapshot().count { it.scope == scope }
            )
        } ?: return null
        if (outcome.retainedCount > 0) scheduleRetry(context)
        return outcome
    }

    suspend fun flush(context: Context): CaptureFlushOutcome {
        val scope = resolveScope(context)
        val outcome = queue(context).flush(
            currentScope = scope,
            client = submissionClient(),
            beforeCommitFollowUps = { followUps ->
                enqueueFollowUps(context, scope, followUps)
            }
        )
        if (outcome.followUps.isNotEmpty()) {
            QuickEditCoordinator.presentNextAsync(context)
        }
        return outcome
    }

    suspend fun purgeForSessionTransition(context: Context) {
        queue(context).purgeForSessionTransition()
        QuickEditCoordinator.purgeForSessionTransition(context)
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    fun scheduleRetry(context: Context) {
        val applicationContext = context.applicationContext
        retryWorkScheduler.schedule(
            hasPendingCaptures = {
                queue(applicationContext).snapshot().isNotEmpty()
            },
            enqueueRetryWork = { enqueueRetryWork(applicationContext) }
        )
    }

    private fun enqueueRetryWork(context: Context) {
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
            ExistingWorkPolicy.APPEND_OR_REPLACE,
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

    private suspend fun enqueueFollowUps(
        context: Context,
        expectedScope: CaptureSessionScope,
        followUps: List<CaptureDeliveryFollowUp>
    ) {
        followUps.forEach { followUp ->
            QuickEditCoordinator.enqueueAndPresent(context, expectedScope, followUp)
        }
    }

    private fun submissionClient(): CaptureSubmissionClient {
        val delegate = CallableCaptureSubmissionClient(
            FirebaseAuthenticatedCallableGateway()
        )
        return object : CaptureSubmissionClient {
            override suspend fun submit(
                envelope: CaptureDeliveryEnvelope
            ): CaptureSubmissionReceipt {
                AndroidCaptureLatencyTelemetry.mark(
                    observationId = envelope.observationId,
                    stage = CaptureLatencyStage.CALLABLE_START
                )
                return try {
                    delegate.submit(envelope).also {
                        AndroidCaptureLatencyTelemetry.mark(
                            observationId = envelope.observationId,
                            stage = CaptureLatencyStage.CALLABLE_END
                        )
                    }
                } catch (exception: Exception) {
                    AndroidCaptureLatencyTelemetry.mark(
                        observationId = envelope.observationId,
                        stage = CaptureLatencyStage.CALLABLE_END,
                        outcome = CaptureLatencyOutcome.FAILURE
                    )
                    throw exception
                }
            }
        }
    }

    private const val WORK_NAME = "capture-envelope-delivery.v1"
}
