package com.household.account.startup

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ApplicationStartupTasksTest {
    @Test
    fun `FCM 차단은 먼저 실행하고 QuickEdit 복구는 지연하며 전체 작업은 한 번만 예약한다`() =
        runTest {
            val events = mutableListOf<String>()
            val tasks = ApplicationStartupTasks(
                scope = this,
                quickEditRecoveryDelayMillis = 1_000L,
                enforceFcmDeliveryGate = { events += "fcm-gate" },
                resumeQuickEditOutbox = { events += "quick-edit-recovery" }
            )

            tasks.schedule()
            tasks.schedule()
            runCurrent()

            assertEquals(listOf("fcm-gate"), events)

            advanceTimeBy(999L)
            runCurrent()
            assertEquals(listOf("fcm-gate"), events)

            advanceTimeBy(1L)
            runCurrent()
            assertEquals(listOf("fcm-gate", "quick-edit-recovery"), events)
        }

    @Test
    fun `FCM 차단 실패가 지연된 QuickEdit 복구를 취소하지 않는다`() = runTest {
        var recovered = false
        val tasks = ApplicationStartupTasks(
            scope = this,
            quickEditRecoveryDelayMillis = 1_000L,
            enforceFcmDeliveryGate = { error("package manager unavailable") },
            resumeQuickEditOutbox = { recovered = true }
        )

        tasks.schedule()
        advanceTimeBy(1_000L)
        runCurrent()

        assertTrue(recovered)
    }
}
