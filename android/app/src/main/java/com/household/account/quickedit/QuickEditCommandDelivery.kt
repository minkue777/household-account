package com.household.account.quickedit

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.await
import com.household.account.MainActivity
import com.household.account.R
import com.household.account.ledger.CallableHouseholdCommandClient
import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.util.HouseholdPreferences
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface QuickEditCommandEnqueueResult {
    data object Accepted : QuickEditCommandEnqueueResult
    data class Rejected(val code: String) : QuickEditCommandEnqueueResult
}

object QuickEditCommandDelivery {
    @Volatile
    private var outboxInstance: QuickEditCommandOutbox? = null
    private val deliveryScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val deliveryLifecycle = QuickEditCommandDeliveryLifecycle()

    private fun outbox(context: Context): QuickEditCommandOutbox =
        outboxInstance ?: synchronized(this) {
            outboxInstance ?: QuickEditCommandOutbox(
                AndroidKeystoreQuickEditCommandOutboxStore(context.applicationContext)
            ).also { outboxInstance = it }
        }

    /**
     * 암호화 outbox commit과 WorkManager 영속 예약까지만 기다립니다. 서버 응답은 기다리지 않습니다.
     */
    suspend fun enqueueAndDispatch(
        context: Context,
        transactionId: String,
        envelope: HouseholdCommandEnvelopeV1
    ): QuickEditCommandEnqueueResult {
        val applicationContext = context.applicationContext
        val enqueueResult = deliveryLifecycle.admit(
            currentScope = { currentScope(applicationContext) },
            transactionId = transactionId,
            envelope = envelope,
            persist = { scope, storedTransactionId, storedEnvelope ->
                withContext(Dispatchers.IO) {
                    outbox(applicationContext).enqueue(
                        scope,
                        storedTransactionId,
                        storedEnvelope
                    )
                }
            },
            reserveDelivery = { scheduleRetry(applicationContext) }
        )
        if (enqueueResult !is QuickEditCommandEnqueueResult.Accepted) return enqueueResult

        deliveryScope.launch { flush(applicationContext) }
        return QuickEditCommandEnqueueResult.Accepted
    }

    /** Process가 outbox commit 뒤 종료됐어도 저장된 envelope 전달을 다시 예약합니다. */
    fun resumePending(context: Context) {
        val applicationContext = context.applicationContext
        deliveryScope.launch {
            try {
                deliveryLifecycle.runExclusive {
                    val scope = currentScope(applicationContext)
                    notifyUnrecoverableLoss(applicationContext)
                    notifyFailures(
                        applicationContext,
                        outbox(applicationContext).snapshot().filter {
                            it.scope == scope && it.failureNotificationPending
                        }
                    )

                    val remaining = outbox(applicationContext).snapshot()
                    val requiresRecovery = remaining.any {
                        it.scope == scope &&
                            it.deliveryState == QuickEditCommandDeliveryState.PENDING
                    } || pendingFailureNotificationCount(applicationContext) > 0
                    if (requiresRecovery) scheduleRecovery(applicationContext)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // 다음 application 시작 또는 이미 예약된 Worker가 다시 복구한다.
            }
        }
    }

    suspend fun flush(context: Context): QuickEditCommandFlushOutcome {
        val applicationContext = context.applicationContext
        // 서버 왕복은 session lifecycle lock 밖에서 수행한다. outbox 자체 delivery mutex가
        // purge와 전송을 직렬화하므로, 느린 네트워크가 다음 QuickEdit 로컬 접수를 막지 않는다.
        outbox(applicationContext).flush(
            currentScope = currentScope(applicationContext),
            client = CallableHouseholdCommandClient(FirebaseAuthenticatedCallableGateway())
        )

        return deliveryLifecycle.runExclusive {
            val scope = currentScope(applicationContext)
            notifyUnrecoverableLoss(applicationContext)
            notifyFailures(
                applicationContext,
                outbox(applicationContext).snapshot().filter {
                    it.scope == scope && it.failureNotificationPending
                }
            )
            val remaining = outbox(applicationContext).snapshot()
            val failuresAwaitingNotification = remaining.filter {
                it.scope == scope && it.failureNotificationPending
            }
            QuickEditCommandFlushOutcome(
                pendingCount = remaining.count {
                    it.scope == scope &&
                        it.deliveryState == QuickEditCommandDeliveryState.PENDING
                },
                failuresAwaitingNotification = failuresAwaitingNotification,
                failureNotificationPendingCount =
                    failuresAwaitingNotification.size +
                        if (
                            outbox(applicationContext)
                                .hasUnrecoverableLossNotificationPending()
                        ) 1 else 0
            )
        }
    }

    suspend fun purgeForSessionTransition(context: Context, previousScope: CaptureSessionScope? = currentScope(context)) =
        deliveryLifecycle.purge(
            currentScope = { previousScope ?: currentScope(context) },
            clearOutbox = { outbox(context).purgeForSessionTransition() },
            cancelDelivery = {
                WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME).await()
            }
        )

    suspend fun resumeAfterFailedTransition(scope: CaptureSessionScope) =
        deliveryLifecycle.resumeAfterFailedTransition(scope)

    private suspend fun scheduleRetry(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            retryRequest()
        ).await()
    }

    private suspend fun scheduleRecovery(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME,
            ExistingWorkPolicy.KEEP,
            retryRequest()
        ).await()
    }

    private fun retryRequest() = OneTimeWorkRequestBuilder<QuickEditCommandDeliveryWorker>()
        .setConstraints(
            Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
        )
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
        .build()

    private suspend fun notifyFailures(
        context: Context,
        entries: List<QuickEditCommandOutboxEntry>
    ) {
        entries.forEach { entry ->
            if (QuickEditCommandFailureNotifier.show(context, entry)) {
                outbox(context).markFailureNotificationDelivered(entry.envelope.commandId)
            }
        }
    }

    private suspend fun notifyUnrecoverableLoss(context: Context) {
        if (
            outbox(context).hasUnrecoverableLossNotificationPending() &&
            QuickEditCommandFailureNotifier.showUnrecoverableLoss(context)
        ) {
            outbox(context).acknowledgeUnrecoverableLossNotification()
        }
    }

    private suspend fun pendingFailureNotificationCount(context: Context): Int {
        val scope = currentScope(context)
        val terminalFailures = outbox(context).snapshot().count {
            it.scope == scope && it.failureNotificationPending
        }
        val storageFailure = if (
            outbox(context).hasUnrecoverableLossNotificationPending()
        ) 1 else 0
        return terminalFailures + storageFailure
    }

    private fun currentScope(context: Context) = HouseholdPreferences.currentScope(context)

    private const val WORK_NAME = "quick-edit-command-delivery.v1"
}

class QuickEditCommandDeliveryWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val outcome = try {
            QuickEditCommandDelivery.flush(applicationContext)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return Result.retry()
        }
        return if (outcome.requiresWorkerRetry) Result.retry() else Result.success()
    }
}

private object QuickEditCommandFailureNotifier {
    private const val CHANNEL_ID = "quick_edit_command_failures"
    private const val CHANNEL_NAME = "빠른 편집 처리 오류"

    fun show(context: Context, entry: QuickEditCommandOutboxEntry): Boolean =
        showNotification(
            context = context,
            notificationId = entry.envelope.commandId.hashCode(),
            title = "빠른 편집을 반영하지 못했습니다",
            text = "앱에서 최신 지출 내역을 확인해 주세요"
        )

    fun showUnrecoverableLoss(context: Context): Boolean = showNotification(
        context = context,
        notificationId = STORAGE_FAILURE_NOTIFICATION_ID,
        title = "빠른 편집 일부를 복구하지 못했습니다",
        text = "앱에서 최근 지출 내역을 확인해 주세요"
    )

    private fun showNotification(
        context: Context,
        notificationId: Int,
        title: String,
        text: String
    ): Boolean = runCatching {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return@runCatching false
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return@runCatching false
        }

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
            )
        )
        if (
            manager.getNotificationChannel(CHANNEL_ID)?.importance ==
            NotificationManager.IMPORTANCE_NONE
        ) {
            return@runCatching false
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        manager.notify(notificationId, notification)
        true
    }.getOrDefault(false)

    private const val STORAGE_FAILURE_NOTIFICATION_ID = 0x51454F42
}
