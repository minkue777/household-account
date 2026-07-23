package com.household.account.paymentcapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureLatencyRecorderTest {
    @Test
    fun `detailed logging connects every stage with one observation id`() {
        val logs = mutableListOf<Pair<CaptureLatencyLogLevel, String>>()
        val recorder = CaptureLatencyRecorder(
            elapsedRealtimeMillis = { error("explicit test timestamp required") },
            detailedLoggingEnabled = { true },
            emit = { level, message -> logs += level to message }
        )
        val observationId = "observation.android.telemetrytest"
        val correlationId = "70e901a993f5774d"

        recorder.mark(
            observationId,
            CaptureLatencyStage.NOTIFICATION_RECEIVED,
            atElapsedRealtimeMillis = 100L
        )
        recorder.mark(
            observationId,
            CaptureLatencyStage.JOURNAL_PERSISTED,
            atElapsedRealtimeMillis = 130L
        )
        recorder.mark(
            observationId,
            CaptureLatencyStage.CALLABLE_START,
            atElapsedRealtimeMillis = 140L
        )
        recorder.mark(
            observationId,
            CaptureLatencyStage.CALLABLE_END,
            atElapsedRealtimeMillis = 340L
        )
        recorder.mark(
            observationId,
            CaptureLatencyStage.FOLLOW_UP_PERSISTED,
            atElapsedRealtimeMillis = 350L
        )
        recorder.mark(
            observationId,
            CaptureLatencyStage.QUICK_EDIT_LAUNCH,
            atElapsedRealtimeMillis = 370L
        )
        recorder.mark(
            observationId,
            CaptureLatencyStage.QUICK_EDIT_SHOWN,
            atElapsedRealtimeMillis = 410L
        )

        val detailed = logs.filter { it.first == CaptureLatencyLogLevel.DEBUG }
        val summary = logs.single { it.first == CaptureLatencyLogLevel.INFO }.second
        assertEquals(CaptureLatencyStage.entries.size, detailed.size)
        assertTrue(logs.all { "correlationId=$correlationId" in it.second })
        assertTrue(logs.none { observationId in it.second })
        assertTrue(detailed.all { "elapsedRealtimeMs=" in it.second })
        assertTrue("notificationToJournalMs=30" in summary)
        assertTrue("callableMs=200" in summary)
        assertTrue("callableEndToFollowUpMs=10" in summary)
        assertTrue("followUpToLaunchMs=20" in summary)
        assertTrue("launchToShownMs=40" in summary)
        assertTrue("totalMs=310" in summary)
    }

    @Test
    fun `production logging emits only one completion summary`() {
        val logs = mutableListOf<Pair<CaptureLatencyLogLevel, String>>()
        val recorder = CaptureLatencyRecorder(
            elapsedRealtimeMillis = { 0L },
            detailedLoggingEnabled = { false },
            emit = { level, message -> logs += level to message }
        )
        val observationId = "observation.android.productiontest"

        CaptureLatencyStage.entries.forEachIndexed { index, stage ->
            recorder.mark(
                observationId,
                stage,
                atElapsedRealtimeMillis = index * 10L
            )
        }

        assertEquals(1, logs.size)
        assertEquals(CaptureLatencyLogLevel.INFO, logs.single().first)
        assertTrue("correlationId=79fb93e66b542d64" in logs.single().second)
        assertFalse(observationId in logs.single().second)
        assertTrue("recordedStages=7" in logs.single().second)
    }

    @Test
    fun `unsafe observation id cannot inject sensitive fields into logs`() {
        val logs = mutableListOf<String>()
        val recorder = CaptureLatencyRecorder(
            elapsedRealtimeMillis = { 10L },
            detailedLoggingEnabled = { true },
            emit = { _, message -> logs += message }
        )

        recorder.mark(
            observationId = "observation.android.safe\nhouseholdId=secret amount=50000",
            stage = CaptureLatencyStage.NOTIFICATION_RECEIVED
        )

        assertTrue(logs.isEmpty())
        assertFalse(logs.any { "householdId" in it || "amount" in it })
    }

    @Test
    fun `telemetry sink failure never changes capture flow`() {
        val recorder = CaptureLatencyRecorder(
            elapsedRealtimeMillis = { 10L },
            detailedLoggingEnabled = { true },
            emit = { _, _ -> error("LOG_SINK_UNAVAILABLE") }
        )

        recorder.mark(
            observationId = "observation.android.sinkfailure",
            stage = CaptureLatencyStage.QUICK_EDIT_SHOWN
        )
    }
}
