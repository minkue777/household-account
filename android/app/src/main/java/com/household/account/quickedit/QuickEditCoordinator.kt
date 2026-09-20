package com.household.account.quickedit

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.provider.Settings
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.await
import com.household.account.QuickEditActivity
import com.household.account.ledger.CallableLedgerTransactionQueryClient
import com.household.account.ledger.LedgerTransactionQueryResult
import com.household.account.ledger.LedgerTransactionSnapshot
import com.household.account.paymentcapture.AndroidCaptureLatencyTelemetry
import com.household.account.paymentcapture.CaptureDeliveryFollowUp
import com.household.account.paymentcapture.CaptureLatencyOutcome
import com.household.account.paymentcapture.CaptureLatencyStage
import com.household.account.paymentcapture.CaptureQuickEditSnapshot
import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.util.HouseholdPreferences
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

object QuickEditCoordinator {
    @Volatile
    private var queueInstance: QuickEditPendingQueue? = null
    @Volatile
    private var processRecovered = false
    private val recoveryMutex = Mutex()
    private val presentationMutex = Mutex()
    private val presentationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    internal val presentations = QuickEditPresentationRegistry(SystemClock::elapsedRealtime)

    private fun queue(context: Context): QuickEditPendingQueue =
        queueInstance ?: synchronized(this) {
            queueInstance ?: QuickEditPendingQueue(
                AndroidKeystoreQuickEditQueueStore(context.applicationContext)
            ).also { queueInstance = it }
        }

    suspend fun enqueueAndPresent(
        context: Context,
        expectedScope: CaptureSessionScope,
        followUp: CaptureDeliveryFollowUp
    ) = presentationMutex.withLock {
        enqueueAndPresentLocked(context, expectedScope, followUp)
    }

    private suspend fun enqueueAndPresentLocked(
        context: Context,
        expectedScope: CaptureSessionScope,
        followUp: CaptureDeliveryFollowUp
    ) {
        if (!HouseholdPreferences.isQuickEditOverlayEnabled(context)) return
        if (!Settings.canDrawOverlays(context)) return
        ensureProcessRecovered(context)
        val scope = currentScope(context)
        if (scope != expectedScope) return
        releaseInactivePresentation(context, scope)
        val result = queue(context).enqueueAndAcquireIfIdle(
            scope = scope,
            transactionId = followUp.transactionId,
            snapshot = followUp.quickEditSnapshot,
            observationId = followUp.observationId
        )
        if (!result.accepted) return
        AndroidCaptureLatencyTelemetry.mark(
            observationId = followUp.observationId,
            stage = CaptureLatencyStage.FOLLOW_UP_PERSISTED
        )
        val head = result.acquiredHead ?: return
        val snapshot = head.snapshot
        if (snapshot == null) {
            queue(context).releaseLease(scope, head.transactionId)
            presentNextAsync(context)
            return
        }
        val launched = launchQuickEdit(
            context = context.applicationContext,
            expectedScope = scope,
            snapshot = snapshot.toLedgerSnapshot(),
            observationId = head.observationId
        )
        if (!launched) {
            queue(context).releaseLease(scope, head.transactionId)
            scheduleRecovery(context.applicationContext)
        }
    }

    suspend fun resumePending(context: Context) = withContext(Dispatchers.IO) {
        presentNext(context)
    }

    suspend fun completeCurrent(context: Context, expectedScope: CaptureSessionScope, transactionId: String) {
        withContext(Dispatchers.IO) {
            presentationMutex.withLock {
                if (!QuickEditCommandDelivery.isCurrentSession(context, expectedScope)) return@withLock
                queue(context).complete(expectedScope, transactionId)
                presentations.complete(expectedScope, transactionId)
            }
        }
    }

    fun presentNextAsync(context: Context) {
        val applicationContext = context.applicationContext
        presentationScope.launch { presentNext(applicationContext) }
    }

    suspend fun purgeForSessionTransition(context: Context, previousScope: CaptureSessionScope? = currentScope(context)) = presentationMutex.withLock {
        queue(context).purge(previousScope)
        presentations.purge(previousScope)
        QuickEditCommandDelivery.purgeForSessionTransition(context, previousScope)
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME).await()
    }

    suspend fun resumeAfterFailedTransition(context: Context, scope: CaptureSessionScope) {
        queue(context).resumeAfterFailedTransition(scope)
        QuickEditCommandDelivery.resumeAfterFailedTransition(scope)
    }

    private suspend fun ensureProcessRecovered(context: Context) = recoveryMutex.withLock {
        if (processRecovered) return@withLock
        queue(context).recoverAfterProcessStart()
        processRecovered = true
    }

    private suspend fun presentNext(context: Context) = presentationMutex.withLock {
        ensureProcessRecovered(context)
        presentNextLocked(context)
    }

    private suspend fun releaseInactivePresentation(context: Context, scope: CaptureSessionScope) {
        val activeId = queue(context).snapshot().activeTransactionId ?: return
        if (presentations.needsRecovery(scope, activeId)) {
            queue(context).releaseLease(scope, activeId)
        }
    }

    private suspend fun presentNextLocked(context: Context) {
        val applicationContext = context.applicationContext
        if (!HouseholdPreferences.isQuickEditOverlayEnabled(applicationContext) ||
            !Settings.canDrawOverlays(applicationContext)) return
        val scope = currentScope(applicationContext)
        if (!scope.isUsable) return
        releaseInactivePresentation(applicationContext, scope)

        while (true) {
            val entry = queue(applicationContext).acquireHead(scope) ?: return
            entry.snapshot?.let { snapshot ->
                val launched = launchQuickEdit(
                    context = applicationContext,
                    expectedScope = scope,
                    snapshot = snapshot.toLedgerSnapshot(),
                    observationId = entry.observationId
                )
                if (!launched) {
                    queue(applicationContext).releaseLease(scope, entry.transactionId)
                    scheduleRecovery(applicationContext)
                }
                return
            }
            val result = CallableLedgerTransactionQueryClient(
                FirebaseAuthenticatedCallableGateway()
            ).get(scope.householdId, entry.transactionId)

            when (result) {
                is LedgerTransactionQueryResult.Success -> {
                    val snapshot = result.value
                    if (
                        snapshot.lifecycleState != "active" ||
                        snapshot.transactionType != "expense"
                    ) {
                        queue(applicationContext).complete(scope, entry.transactionId)
                        continue
                    }
                    val launched = launchQuickEdit(
                        context = applicationContext,
                        expectedScope = scope,
                        snapshot = snapshot,
                        observationId = entry.observationId
                    )
                    if (!launched) {
                        queue(applicationContext).releaseLease(scope, entry.transactionId)
                        scheduleRecovery(applicationContext)
                    }
                    return
                }
                LedgerTransactionQueryResult.NotFound,
                LedgerTransactionQueryResult.Forbidden -> {
                    queue(applicationContext).complete(scope, entry.transactionId)
                }
                is LedgerTransactionQueryResult.ContractFailure -> {
                    // 알 수 없는 서버 계약을 "편집할 수 없는 거래"로 오인해 버리지 않습니다.
                    // head를 보존해 호환 가능한 앱/서버 배포 뒤 다시 열 수 있게 합니다.
                    queue(applicationContext).releaseLease(scope, entry.transactionId)
                    return
                }
                is LedgerTransactionQueryResult.RetryableFailure -> {
                    queue(applicationContext).releaseLease(scope, entry.transactionId)
                    scheduleRecovery(applicationContext)
                    return
                }
            }
        }
    }

    private suspend fun launchQuickEdit(
        context: Context,
        expectedScope: CaptureSessionScope,
        snapshot: LedgerTransactionSnapshot,
        observationId: String?
    ): Boolean {
        if (!QuickEditCommandDelivery.isCurrentSession(context, expectedScope) ||
            !HouseholdPreferences.isQuickEditOverlayEnabled(context) ||
            !Settings.canDrawOverlays(context)) return false
        // Android가 기존 Activity를 재생성한 직후라면 이미 살아 있는 화면을 유지합니다.
        if (!presentations.needsRecovery(expectedScope, snapshot.transactionId)) return true
        val intent = Intent(context, QuickEditActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
            if (presentations.canReuseActivity(expectedScope, snapshot.transactionId)) {
                addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            }
            putExtra(QuickEditActivity.EXTRA_HOUSEHOLD_ID, expectedScope.householdId)
            putExtra(QuickEditActivity.EXTRA_MEMBER_ID, expectedScope.memberId)
            putExtra(QuickEditActivity.EXTRA_SESSION_GENERATION, expectedScope.sessionGeneration)
            putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, snapshot.transactionId)
            putExtra(QuickEditActivity.EXTRA_MERCHANT, snapshot.merchant)
            putExtra(QuickEditActivity.EXTRA_AMOUNT, snapshot.amountInWon)
            putExtra(QuickEditActivity.EXTRA_DATE, snapshot.accountingDate)
            putExtra(QuickEditActivity.EXTRA_TIME, snapshot.localTime)
            putExtra(QuickEditActivity.EXTRA_CATEGORY, snapshot.categoryId)
            putExtra(QuickEditActivity.EXTRA_MEMO, snapshot.memo)
            putExtra(QuickEditActivity.EXTRA_VERSION, snapshot.aggregateVersion)
            observationId?.let {
                putExtra(QuickEditActivity.EXTRA_CAPTURE_OBSERVATION_ID, it)
            }
        }
        observationId?.let {
            AndroidCaptureLatencyTelemetry.mark(
                observationId = it,
                stage = CaptureLatencyStage.QUICK_EDIT_LAUNCH
            )
        }
        val requestId = presentations.beginLaunch(expectedScope, snapshot.transactionId)
        val launched = withContext(Dispatchers.Main.immediate) {
            runCatching {
                check(QuickEditCommandDelivery.isCurrentSession(context, expectedScope))
                context.startActivity(intent)
            }.isSuccess
        }
        if (launched) {
            watchForUnshownActivity(context, expectedScope, snapshot.transactionId, requestId, observationId)
        } else {
            presentations.complete(expectedScope, snapshot.transactionId)
        }
        if (!launched) observationId?.let {
            AndroidCaptureLatencyTelemetry.mark(
                observationId = it,
                stage = CaptureLatencyStage.QUICK_EDIT_LAUNCH,
                outcome = CaptureLatencyOutcome.FAILURE
            )
        }
        return launched
    }

    private fun watchForUnshownActivity(
        context: Context,
        scope: CaptureSessionScope,
        transactionId: String,
        requestId: Long,
        observationId: String?
    ) {
        presentationScope.launch {
            delay(QuickEditPresentationRegistry.LAUNCH_TIMEOUT_MILLIS)
            presentationMutex.withLock {
                if (!QuickEditCommandDelivery.isCurrentSession(context, scope) ||
                    !presentations.expireLaunch(scope, transactionId, requestId)) return@withLock
                queue(context).releaseLease(scope, transactionId)
                observationId?.let {
                    AndroidCaptureLatencyTelemetry.mark(it, CaptureLatencyStage.QUICK_EDIT_LAUNCH, CaptureLatencyOutcome.FAILURE)
                }
                // OS 차단을 빠른 팝업 재시도 루프로 만들지 않습니다. 다음 결제/재진입은 즉시 복구합니다.
                scheduleRecovery(context, delayed = true)
            }
        }
    }

    private fun CaptureQuickEditSnapshot.toLedgerSnapshot() = LedgerTransactionSnapshot(
        transactionId = transactionId,
        aggregateVersion = aggregateVersion,
        lifecycleState = "active",
        transactionType = "expense",
        amountInWon = amountInWon,
        accountingDate = accountingDate,
        localTime = localTime,
        merchant = merchant,
        categoryId = categoryId,
        memo = memo
    )

    private fun scheduleRecovery(context: Context, delayed: Boolean = false) {
        val request = OneTimeWorkRequestBuilder<QuickEditRecoveryWorker>()
            .setInitialDelay(if (delayed) 15L else 0L, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    private fun currentScope(context: Context) = HouseholdPreferences.currentScope(context)

    private const val WORK_NAME = "quick-edit-presentation.v1"
}

class QuickEditRecoveryWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return runCatching {
            QuickEditCoordinator.resumePending(applicationContext)
            Result.success()
        }.getOrElse { Result.retry() }
    }
}
