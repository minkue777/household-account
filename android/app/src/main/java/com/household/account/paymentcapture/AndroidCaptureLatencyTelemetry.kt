package com.household.account.paymentcapture

import android.os.SystemClock
import android.util.Log
import com.household.account.BuildConfig

internal object AndroidCaptureLatencyTelemetry {
    const val LOG_TAG = "HHCaptureLatency"

    private val recorder = CaptureLatencyRecorder(
        elapsedRealtimeMillis = SystemClock::elapsedRealtime,
        detailedLoggingEnabled = {
            BuildConfig.DEBUG || Log.isLoggable(LOG_TAG, Log.DEBUG)
        },
        emit = { level, message ->
            when (level) {
                CaptureLatencyLogLevel.DEBUG -> Log.d(LOG_TAG, message)
                CaptureLatencyLogLevel.INFO -> Log.i(LOG_TAG, message)
            }
        }
    )

    fun elapsedRealtimeMillis(): Long = SystemClock.elapsedRealtime()

    fun mark(
        observationId: String,
        stage: CaptureLatencyStage,
        outcome: CaptureLatencyOutcome = CaptureLatencyOutcome.SUCCESS,
        atElapsedRealtimeMillis: Long = elapsedRealtimeMillis()
    ) {
        recorder.mark(
            observationId = observationId,
            stage = stage,
            outcome = outcome,
            atElapsedRealtimeMillis = atElapsedRealtimeMillis
        )
    }
}
