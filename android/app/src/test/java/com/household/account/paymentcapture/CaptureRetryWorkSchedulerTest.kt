package com.household.account.paymentcapture

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CaptureRetryWorkSchedulerTest {
    @Test
    fun `암호화 큐 확인과 Worker 예약은 호출 스택 밖의 coroutine에서 실행한다`() = runTest {
        var queueInspected = false
        var workEnqueued = false
        val scheduler = CaptureRetryWorkScheduler(this)

        scheduler.schedule(
            hasPendingCaptures = {
                queueInspected = true
                true
            },
            enqueueRetryWork = { workEnqueued = true }
        )

        assertFalse(queueInspected)
        assertFalse(workEnqueued)

        runCurrent()

        assertTrue(queueInspected)
        assertTrue(workEnqueued)
    }

    @Test
    fun `대기 중인 캡처가 없으면 Worker를 예약하지 않는다`() = runTest {
        var workEnqueued = false
        val scheduler = CaptureRetryWorkScheduler(this)

        scheduler.schedule(
            hasPendingCaptures = { false },
            enqueueRetryWork = { workEnqueued = true }
        )
        runCurrent()

        assertFalse(workEnqueued)
    }
}
