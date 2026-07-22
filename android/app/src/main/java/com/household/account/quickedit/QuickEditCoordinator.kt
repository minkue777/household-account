package com.household.account.quickedit

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.household.account.QuickEditActivity
import com.household.account.ledger.CallableLedgerTransactionQueryClient
import com.household.account.ledger.LedgerTransactionQueryResult
import com.household.account.paymentcapture.CaptureDeliveryFollowUp
import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.util.HouseholdPreferences
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
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
    private val presentationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun queue(context: Context): QuickEditPendingQueue =
        queueInstance ?: synchronized(this) {
            queueInstance ?: QuickEditPendingQueue(
                AndroidKeystoreQuickEditQueueStore(context.applicationContext)
            ).also { queueInstance = it }
        }

    suspend fun enqueueAndPresent(context: Context, followUp: CaptureDeliveryFollowUp) {
        if (!HouseholdPreferences.isQuickEditOverlayEnabled(context)) return
        if (!Settings.canDrawOverlays(context)) return
        ensureProcessRecovered(context)
        val scope = currentScope(context)
        if (!queue(context).enqueue(scope, followUp.transactionId)) return
        presentNext(context)
    }

    suspend fun resumePending(context: Context) {
        ensureProcessRecovered(context)
        presentNext(context)
    }

    suspend fun completeCurrent(context: Context, transactionId: String) {
        withContext(Dispatchers.IO) {
            val scope = currentScope(context)
            queue(context).complete(scope, transactionId)
        }
    }

    fun presentNextAsync(context: Context) {
        val applicationContext = context.applicationContext
        presentationScope.launch { presentNext(applicationContext) }
    }

    suspend fun purgeForSessionTransition(context: Context) {
        queue(context).purge()
        QuickEditCommandDelivery.purgeForSessionTransition(context)
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    private suspend fun ensureProcessRecovered(context: Context) = recoveryMutex.withLock {
        if (processRecovered) return@withLock
        queue(context).recoverAfterProcessStart()
        processRecovered = true
    }

    private suspend fun presentNext(context: Context) {
        val applicationContext = context.applicationContext
        val scope = currentScope(applicationContext)
        if (!scope.isUsable) return

        while (true) {
            val entry = queue(applicationContext).acquireHead(scope) ?: return
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
                    val intent = Intent(applicationContext, QuickEditActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
                        putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, snapshot.transactionId)
                        putExtra(QuickEditActivity.EXTRA_MERCHANT, snapshot.merchant)
                        putExtra(QuickEditActivity.EXTRA_AMOUNT, snapshot.amountInWon)
                        putExtra(QuickEditActivity.EXTRA_DATE, snapshot.accountingDate)
                        putExtra(QuickEditActivity.EXTRA_TIME, snapshot.localTime)
                        putExtra(QuickEditActivity.EXTRA_CATEGORY, snapshot.categoryId)
                        putExtra(QuickEditActivity.EXTRA_MEMO, snapshot.memo)
                        putExtra(QuickEditActivity.EXTRA_VERSION, snapshot.aggregateVersion)
                    }
                    val launched = runCatching { applicationContext.startActivity(intent) }.isSuccess
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

    private fun scheduleRecovery(context: Context) {
        val request = OneTimeWorkRequestBuilder<QuickEditRecoveryWorker>()
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

    private fun currentScope(context: Context) = CaptureSessionScope(
        HouseholdPreferences.getHouseholdKey(context),
        HouseholdPreferences.getMemberId(context),
        HouseholdPreferences.getSessionGeneration(context)
    )

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
