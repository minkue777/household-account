package com.household.account.paymentcapture

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.await
import com.household.account.quickedit.QuickEditCoordinator
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.session.NativeMembershipResolution
import com.household.account.session.NativeMembershipResolver
import com.household.account.util.HouseholdPreferences
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
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

    suspend fun enqueueBatchAndFlush(
        context: Context,
        envelopes: List<CaptureDeliveryEnvelope>,
        onFailure: (CaptureDeliveryFailure) -> Unit = {}
    ): CaptureFlushOutcome? {
        if (envelopes.isEmpty()) return null
        val reportFailure: (CaptureDeliveryFailure) -> Unit = {
            logFailure(it)
            onFailure(it)
        }
        var stage = CaptureDeliveryFailureStage.SCOPE
        val outcome = try {
            val scope = resolveScope(context)
            if (!scope.isUsable) {
                envelopes.forEach {
                    reportFailure(CaptureDeliveryFailure(it.observationId, stage, "SCOPE_UNAVAILABLE"))
                }
                return null
            }
            stage = CaptureDeliveryFailureStage.ENQUEUE
            enqueueAndSubmitCaptureBatch(
                queue = queue(context),
                scope = scope,
                envelopes = envelopes,
                client = submissionClient(),
                afterJournalPersisted = { persisted ->
                    stage = CaptureDeliveryFailureStage.QUEUE_READ
                    persisted.forEach { envelope ->
                        AndroidCaptureLatencyTelemetry.mark(
                            observationId = envelope.observationId,
                            stage = CaptureLatencyStage.JOURNAL_PERSISTED
                        )
                    }
                },
                beforeCommitFollowUps = { followUps ->
                    enqueueFollowUps(context, scope, followUps)
                },
                onFailure = reportFailure
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            envelopes.forEach {
                reportFailure(CaptureDeliveryFailure.from(it.observationId, stage, error))
            }
            scheduleRetry(context)
            return null
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
            },
            onFailure = ::logFailure
        )
        if (outcome.followUps.isNotEmpty()) {
            QuickEditCoordinator.presentNextAsync(context)
        }
        return outcome
    }

    suspend fun purgeForSessionTransition(context: Context, previousScope: CaptureSessionScope? = currentScope(context)) {
        try {
            queue(context).purgeForSessionTransition(previousScope)
            QuickEditCoordinator.purgeForSessionTransition(context, previousScope)
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME).await()
        } catch (error: Exception) {
            // The mirror retains the previous actor on failure, so its local input must
            // also remain usable. A successful transition keeps the old generation blocked.
            previousScope?.let { scope ->
                queue(context).resumeAfterFailedTransition(scope)
                QuickEditCoordinator.resumeAfterFailedTransition(context, scope)
            }
            throw error
        }
    }

    fun scheduleRetry(context: Context, shouldSchedule: () -> Boolean = { true }) {
        val applicationContext = context.applicationContext
        retryWorkScheduler.schedule(
            hasPendingCaptures = {
                shouldSchedule() && queue(applicationContext).snapshot().isNotEmpty()
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

    private fun currentScope(context: Context) = HouseholdPreferences.currentScope(context)

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

    private fun logFailure(failure: CaptureDeliveryFailure) {
        Log.w("HHCaptureDelivery", "observationId=${failure.observationId} stage=${failure.stage} code=${failure.code}")
    }
}
