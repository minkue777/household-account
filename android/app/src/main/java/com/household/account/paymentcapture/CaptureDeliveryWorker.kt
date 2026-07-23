package com.household.account.paymentcapture

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class CaptureDeliveryWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        return runCatching {
            val outcome = AndroidCaptureDelivery.flush(applicationContext)
            if (outcome.retainedCount == 0) Result.success() else Result.retry()
        }.getOrElse {
            Result.retry()
        }
    }
}
