package com.household.account.quickedit

import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.paymentcapture.CaptureQuickEditSnapshot
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickEditPendingQueueTest {
    private class MemoryStore : QuickEditQueueStore {
        var state = QuickEditQueueState()
        var replaceCount = 0
        override fun load(): QuickEditQueueState = state
        override fun replace(state: QuickEditQueueState) {
            replaceCount += 1
            this.state = state
        }
        override fun clear() {
            state = QuickEditQueueState()
        }
    }

    private val scope = CaptureSessionScope("household-1", "member-1", 7L)

    @Test
    fun `새 snapshot을 저장하면서 idle head를 한 번의 저장으로 획득한다`() = runTest {
        val store = MemoryStore()
        val queue = QuickEditPendingQueue(store)
        val snapshot = snapshot("transaction-fast")

        val result = queue.enqueueAndAcquireIfIdle(
            scope = scope,
            transactionId = "transaction-fast",
            snapshot = snapshot,
            observationId = "observation.android.fast"
        )

        assertTrue(result.accepted)
        assertEquals("transaction-fast", result.acquiredHead?.transactionId)
        assertEquals(snapshot, result.acquiredHead?.snapshot)
        assertEquals("transaction-fast", store.state.activeTransactionId)
        assertEquals(1, store.replaceCount)
    }

    @Test
    fun `같은 거래를 중복 없이 FIFO로 한 개씩 lease한다`() = runTest {
        val store = MemoryStore()
        var now = 100L
        val queue = QuickEditPendingQueue(store) { now++ }
        queue.enqueue(scope, "transaction-a")
        queue.enqueue(scope, "transaction-a")
        queue.enqueue(scope, "transaction-b")

        assertEquals("transaction-a", queue.acquireHead(scope)?.transactionId)
        assertNull(queue.acquireHead(scope))

        queue.complete(scope, "transaction-a")
        assertEquals("transaction-b", queue.acquireHead(scope)?.transactionId)
        assertEquals(listOf("transaction-b"), store.state.entries.map { it.transactionId })
        assertEquals(3L, store.state.nextSequence)
    }

    @Test
    fun `실패 lease 해제는 head를 보존하고 process 복구는 active만 해제한다`() = runTest {
        val store = MemoryStore()
        val queue = QuickEditPendingQueue(store)
        queue.enqueue(scope, "transaction-a")
        queue.acquireHead(scope)

        queue.recoverAfterProcessStart()

        assertNull(store.state.activeTransactionId)
        assertEquals("transaction-a", queue.acquireHead(scope)?.transactionId)
    }

    @Test
    fun `다른 session generation은 이전 queue를 표시하지 않는다`() = runTest {
        val store = MemoryStore()
        val queue = QuickEditPendingQueue(store)
        queue.enqueue(scope, "transaction-a")

        val nextScope = scope.copy(sessionGeneration = 8L)

        assertNull(queue.acquireHead(nextScope))
        assertTrue(store.state.entries.isEmpty())
    }

    @Test
    fun `서버 snapshot을 FIFO entry에 보존하고 기존 ID 전용 entry도 나중에 보강한다`() = runTest {
        val store = MemoryStore()
        val queue = QuickEditPendingQueue(store)
        val snapshot = snapshot("transaction-a")

        queue.enqueue(scope, "transaction-a")
        queue.enqueue(scope, "transaction-a", snapshot)

        assertEquals(snapshot, queue.acquireHead(scope)?.snapshot)
        assertEquals(1, store.state.entries.size)
        assertEquals(2L, store.state.nextSequence)
    }

    @Test
    fun `observation id is retained when an existing entry is enriched`() = runTest {
        val store = MemoryStore()
        val queue = QuickEditPendingQueue(store)

        queue.enqueue(scope, "transaction-a")
        queue.enqueue(
            scope = scope,
            transactionId = "transaction-a",
            observationId = "observation.android.queue"
        )

        assertEquals(
            "observation.android.queue",
            queue.acquireHead(scope)?.observationId
        )
        assertEquals(1, store.state.entries.size)
    }

    private fun snapshot(transactionId: String) = CaptureQuickEditSnapshot(
        transactionId = transactionId,
        merchant = "가맹점",
        amountInWon = 10_000,
        accountingDate = "2026-07-23",
        localTime = "19:00",
        categoryId = "etc",
        memo = "",
        aggregateVersion = 1
    )
}
