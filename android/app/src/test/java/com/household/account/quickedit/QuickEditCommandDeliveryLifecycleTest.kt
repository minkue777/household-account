package com.household.account.quickedit

import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.paymentcapture.CaptureSessionScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickEditCommandDeliveryLifecycleTest {
    private val scope = CaptureSessionScope("household-1", "member-1", 7L)
    private val envelope = HouseholdCommandEnvelopeV1.create(
        householdId = scope.householdId,
        command = HouseholdCommandKind.UPDATE,
        payload = mapOf(
            "transactionId" to "transaction-1",
            "expectedVersion" to 3,
            "patch" to mapOf("memo" to "수정 메모")
        ),
        operationId = "operation-1"
    )

    @Test
    fun `outbox commit과 Worker 영속 예약 사이에 session purge가 끼어들 수 없다`() = runTest {
        val lifecycle = QuickEditCommandDeliveryLifecycle()
        val scheduleStarted = CompletableDeferred<Unit>()
        val finishSchedule = CompletableDeferred<Unit>()
        val events = mutableListOf<String>()

        val admitting = async {
            lifecycle.admit(
                currentScope = { scope },
                transactionId = "transaction-1",
                envelope = envelope,
                persist = { _, _, _ ->
                    events += "outbox-committed"
                    true
                },
                reserveDelivery = {
                    events += "schedule-started"
                    scheduleStarted.complete(Unit)
                    finishSchedule.await()
                    events += "schedule-persisted"
                }
            )
        }

        scheduleStarted.await()
        val purging = async {
            lifecycle.purge(
                currentScope = { scope },
                clearOutbox = { events += "outbox-cleared" },
                cancelDelivery = { events += "worker-cancelled" }
            )
        }
        assertFalse(purging.isCompleted)

        finishSchedule.complete(Unit)
        assertEquals(QuickEditCommandEnqueueResult.Accepted, admitting.await())
        purging.await()

        assertEquals(
            listOf(
                "outbox-committed",
                "schedule-started",
                "schedule-persisted",
                "outbox-cleared",
                "worker-cancelled"
            ),
            events
        )
    }

    @Test
    fun `purge가 끝난 동일 session은 새 command를 다시 접수하지 않는다`() = runTest {
        val lifecycle = QuickEditCommandDeliveryLifecycle()
        lifecycle.purge(
            currentScope = { scope },
            clearOutbox = {},
            cancelDelivery = {}
        )
        var persisted = false

        val result = lifecycle.admit(
            currentScope = { scope },
            transactionId = "transaction-1",
            envelope = envelope,
            persist = { _, _, _ ->
                persisted = true
                true
            },
            reserveDelivery = {}
        )

        assertEquals(
            QuickEditCommandEnqueueResult.Rejected("SESSION_TRANSITION_IN_PROGRESS"),
            result
        )
        assertFalse(persisted)
    }

    @Test
    fun `Worker 예약 실패는 Accepted가 아니며 저장 payload 재접수를 허용한다`() = runTest {
        val lifecycle = QuickEditCommandDeliveryLifecycle()
        var persistCalls = 0
        var scheduleCalls = 0
        val persist: suspend (
            CaptureSessionScope,
            String,
            HouseholdCommandEnvelopeV1
        ) -> Boolean = { _, _, _ ->
            persistCalls += 1
            true
        }

        val failed = lifecycle.admit(
            currentScope = { scope },
            transactionId = "transaction-1",
            envelope = envelope,
            persist = persist,
            reserveDelivery = {
                scheduleCalls += 1
                error("WorkManager database unavailable")
            }
        )
        val retried = lifecycle.admit(
            currentScope = { scope },
            transactionId = "transaction-1",
            envelope = envelope,
            persist = persist,
            reserveDelivery = { scheduleCalls += 1 }
        )

        assertEquals(
            QuickEditCommandEnqueueResult.Rejected("QUICK_EDIT_WORK_SCHEDULE_FAILED"),
            failed
        )
        assertEquals(QuickEditCommandEnqueueResult.Accepted, retried)
        assertEquals(2, persistCalls)
        assertEquals(2, scheduleCalls)
        assertTrue(retried is QuickEditCommandEnqueueResult.Accepted)
    }
}
