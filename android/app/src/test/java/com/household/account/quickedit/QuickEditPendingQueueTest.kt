package com.household.account.quickedit

import com.household.account.paymentcapture.CaptureSessionScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickEditPendingQueueTest {
    private class MemoryStore : QuickEditQueueStore {
        var state = QuickEditQueueState()
        override fun load(): QuickEditQueueState = state
        override fun replace(state: QuickEditQueueState) {
            this.state = state
        }
        override fun clear() {
            state = QuickEditQueueState()
        }
    }

    private val scope = CaptureSessionScope("household-1", "member-1", 7L)

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
}
