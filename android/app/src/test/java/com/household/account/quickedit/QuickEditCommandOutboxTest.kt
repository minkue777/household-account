package com.household.account.quickedit

import com.household.account.ledger.HouseholdCommandClient
import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.ledger.HouseholdCommandResult
import com.household.account.paymentcapture.CaptureSessionScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickEditCommandOutboxTest {
    private class MemoryStore : QuickEditCommandOutboxStore {
        var entries: List<QuickEditCommandOutboxEntry> = emptyList()
        var unrecoverableLossNotificationPending = false

        override fun load(): List<QuickEditCommandOutboxEntry> = entries

        override fun replace(entries: List<QuickEditCommandOutboxEntry>) {
            this.entries = entries
        }

        override fun clear() {
            entries = emptyList()
            unrecoverableLossNotificationPending = false
        }

        override fun hasUnrecoverableLossNotificationPending(): Boolean =
            unrecoverableLossNotificationPending

        override fun acknowledgeUnrecoverableLossNotification() {
            unrecoverableLossNotificationPending = false
        }
    }

    private class RecordingClient(
        private val results: ArrayDeque<HouseholdCommandResult>
    ) : HouseholdCommandClient {
        val envelopes = mutableListOf<HouseholdCommandEnvelopeV1>()

        override suspend fun execute(
            envelope: HouseholdCommandEnvelopeV1
        ): HouseholdCommandResult {
            envelopes += envelope
            return results.removeFirst()
        }
    }

    private val scope = CaptureSessionScope("household-1", "member-1", 7L)

    @Test
    fun `암호화 commit 뒤 일시 실패를 같은 command id와 idempotency key로 재시도한다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store) { 100L }
        val envelope = envelope("operation-1")
        val client = RecordingClient(
            ArrayDeque(
                listOf(
                    HouseholdCommandResult.RetryableFailure("SERVER_UNAVAILABLE"),
                    HouseholdCommandResult.Succeeded(emptyMap<String, Any?>())
                )
            )
        )

        assertTrue(outbox.enqueue(scope, "transaction-1", envelope))
        assertEquals(listOf(envelope), store.entries.map { it.envelope })

        assertEquals(1, outbox.flush(scope, client).pendingCount)
        assertEquals(0, outbox.flush(scope, client).pendingCount)
        assertEquals(emptyList<QuickEditCommandOutboxEntry>(), store.entries)
        assertEquals(listOf(envelope.commandId, envelope.commandId), client.envelopes.map { it.commandId })
        assertEquals(
            listOf(envelope.idempotencyKey, envelope.idempotencyKey),
            client.envelopes.map { it.idempotencyKey }
        )
    }

    @Test
    fun `충돌은 알림 전까지만 needs attention으로 보존하고 알림 뒤 삭제하며 자동 재시도하지 않는다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store) { 200L }
        val envelope = envelope("operation-conflict")
        val client = RecordingClient(
            ArrayDeque(listOf(HouseholdCommandResult.Conflict(currentVersion = 8)))
        )
        outbox.enqueue(scope, "transaction-1", envelope)

        val first = outbox.flush(scope, client)

        assertEquals(0, first.pendingCount)
        assertEquals(listOf(envelope.commandId), first.failuresAwaitingNotification.map {
            it.envelope.commandId
        })
        assertEquals(QuickEditCommandDeliveryState.NEEDS_ATTENTION, store.entries.single().deliveryState)
        assertEquals("VERSION_MISMATCH", store.entries.single().terminalCode)
        assertTrue(store.entries.single().failureNotificationPending)

        outbox.markFailureNotificationDelivered(envelope.commandId)

        val second = outbox.flush(scope, client)
        assertEquals(0, second.pendingCount)
        assertTrue(second.failuresAwaitingNotification.isEmpty())
        assertEquals(1, client.envelopes.size)
        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `기존 명령이 네트워크 응답을 기다리는 동안에도 다음 명령을 즉시 저장한다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store)
        val first = envelope("operation-slow")
        val second = envelope("operation-next", "transaction-2")
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val client = object : HouseholdCommandClient {
            override suspend fun execute(
                envelope: HouseholdCommandEnvelopeV1
            ): HouseholdCommandResult {
                started.complete(Unit)
                release.await()
                return HouseholdCommandResult.Succeeded(emptyMap<String, Any?>())
            }
        }
        outbox.enqueue(scope, "transaction-1", first)

        val flushing = async { outbox.flush(scope, client) }
        started.await()

        assertTrue(withTimeout(1_000L) {
            outbox.enqueue(scope, "transaction-2", second)
        })
        release.complete(Unit)
        flushing.await()

        assertEquals(listOf(second.commandId), store.entries.map { it.envelope.commandId })
    }

    @Test
    fun `앞 명령이 일시 실패하면 뒤 명령을 추월 전송하지 않는다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store)
        val first = envelope("operation-first")
        val second = envelope("operation-second", "transaction-2")
        outbox.enqueue(scope, "transaction-1", first)
        outbox.enqueue(scope, "transaction-2", second)
        val client = RecordingClient(
            ArrayDeque(
                listOf(
                    HouseholdCommandResult.RetryableFailure("SERVER_UNAVAILABLE"),
                    HouseholdCommandResult.Succeeded(emptyMap<String, Any?>()),
                    HouseholdCommandResult.Succeeded(emptyMap<String, Any?>())
                )
            )
        )

        val firstAttempt = outbox.flush(scope, client)

        assertEquals(2, firstAttempt.pendingCount)
        assertEquals(listOf(first.commandId), client.envelopes.map { it.commandId })

        val secondAttempt = outbox.flush(scope, client)
        assertEquals(0, secondAttempt.pendingCount)
        assertEquals(
            listOf(first.commandId, first.commandId, second.commandId),
            client.envelopes.map { it.commandId }
        )
    }

    @Test
    fun `72시간 재시도 창이 지나면 알림 전 확인 필요 상태로 전환하고 알림 뒤 삭제한다`() = runTest {
        val store = MemoryStore()
        var now = 0L
        val outbox = QuickEditCommandOutbox(store) { now }
        val envelope = envelope("operation-expired")
        outbox.enqueue(scope, "transaction-1", envelope)
        now = QuickEditCommandOutbox.MAX_RETRY_WINDOW_MILLIS
        val client = RecordingClient(ArrayDeque())

        val outcome = outbox.flush(scope, client)

        assertEquals(0, outcome.pendingCount)
        assertTrue(client.envelopes.isEmpty())
        assertEquals(QuickEditCommandDeliveryState.NEEDS_ATTENTION, store.entries.single().deliveryState)
        assertEquals("QUICK_EDIT_RETRY_WINDOW_EXPIRED", store.entries.single().terminalCode)
        assertTrue(store.entries.single().failureNotificationPending)

        outbox.markFailureNotificationDelivered(envelope.commandId)

        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `다른 session 명령은 현재 actor로 전송하거나 삭제하지 않는다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store)
        val envelope = envelope("operation-session")
        outbox.enqueue(scope, "transaction-1", envelope)
        val client = RecordingClient(ArrayDeque())

        val outcome = outbox.flush(scope.copy(sessionGeneration = 8L), client)

        assertEquals(0, outcome.pendingCount)
        assertTrue(client.envelopes.isEmpty())
        assertEquals(listOf(envelope), store.entries.map { it.envelope })
    }

    @Test
    fun `client 예외는 명령을 잃지 않고 retryable pending으로 유지한다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store)
        val envelope = envelope("operation-exception")
        outbox.enqueue(scope, "transaction-1", envelope)
        val throwingClient = object : HouseholdCommandClient {
            override suspend fun execute(
                envelope: HouseholdCommandEnvelopeV1
            ): HouseholdCommandResult = error("network failure")
        }

        val outcome = outbox.flush(scope, throwingClient)

        assertEquals(1, outcome.pendingCount)
        assertEquals(QuickEditCommandDeliveryState.PENDING, store.entries.single().deliveryState)
        assertEquals(envelope, store.entries.single().envelope)
    }

    @Test
    fun `같은 명령은 한 번만 저장하고 terminal 명령을 새 접수로 오인하지 않는다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store) { 300L }
        val envelope = envelope("operation-deduplicated")

        assertTrue(outbox.enqueue(scope, "transaction-1", envelope))
        assertTrue(outbox.enqueue(scope, "transaction-1", envelope))
        assertEquals(1, store.entries.size)

        val client = RecordingClient(
            ArrayDeque(listOf(HouseholdCommandResult.Rejected("NOT_FOUND")))
        )
        outbox.flush(scope, client)

        assertFalse(outbox.enqueue(scope, "transaction-1", envelope))
        assertEquals(1, store.entries.size)
    }

    @Test
    fun `표시 거래와 Ledger payload 거래가 다르면 command를 접수하지 않는다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store)

        assertFalse(
            outbox.enqueue(
                scope,
                "different-transaction",
                envelope("operation-mismatched-transaction")
            )
        )
        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `세션 전환 purge는 진행 중인 전송이 끝난 뒤 반환하고 기존 명령을 모두 제거한다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store)
        val envelope = envelope("operation-session-transition")
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val client = object : HouseholdCommandClient {
            override suspend fun execute(
                envelope: HouseholdCommandEnvelopeV1
            ): HouseholdCommandResult {
                started.complete(Unit)
                release.await()
                return HouseholdCommandResult.Succeeded(emptyMap<String, Any?>())
            }
        }
        outbox.enqueue(scope, "transaction-1", envelope)

        val flushing = async { outbox.flush(scope, client) }
        started.await()
        val purging = async { outbox.purgeForSessionTransition() }

        assertFalse(purging.isCompleted)

        release.complete(Unit)
        flushing.await()
        purging.await()

        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `72시간 직전의 pending 명령은 같은 envelope로 전송한다`() = runTest {
        val store = MemoryStore()
        var now = 0L
        val outbox = QuickEditCommandOutbox(store) { now }
        val envelope = envelope("operation-before-expiry")
        outbox.enqueue(scope, "transaction-1", envelope)
        now = QuickEditCommandOutbox.MAX_RETRY_WINDOW_MILLIS - 1L
        val client = RecordingClient(
            ArrayDeque(listOf(HouseholdCommandResult.Succeeded(emptyMap<String, Any?>())))
        )

        val outcome = outbox.flush(scope, client)

        assertEquals(0, outcome.pendingCount)
        assertEquals(listOf(envelope), client.envelopes)
        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `복호화 불가 진단은 알림 확인 전까지 보존하고 session purge에서 제거한다`() = runTest {
        val store = MemoryStore().apply {
            unrecoverableLossNotificationPending = true
        }
        val outbox = QuickEditCommandOutbox(store)

        assertTrue(outbox.hasUnrecoverableLossNotificationPending())
        outbox.acknowledgeUnrecoverableLossNotification()
        assertFalse(outbox.hasUnrecoverableLossNotificationPending())

        store.unrecoverableLossNotificationPending = true
        outbox.purgeForSessionTransition()
        assertFalse(outbox.hasUnrecoverableLossNotificationPending())
    }

    @Test
    fun `실패 알림이 전달되지 않았으면 서버 pending이 없어도 Worker 재시도를 유지한다`() {
        val awaitingNotification = QuickEditCommandFlushOutcome(
            pendingCount = 0,
            failuresAwaitingNotification = emptyList(),
            failureNotificationPendingCount = 1
        )
        val fullyDelivered = QuickEditCommandFlushOutcome(
            pendingCount = 0,
            failuresAwaitingNotification = emptyList(),
            failureNotificationPendingCount = 0
        )

        assertTrue(awaitingNotification.requiresWorkerRetry)
        assertFalse(fullyDelivered.requiresWorkerRetry)
    }

    @Test
    fun `QuickEdit 전달 어댑터는 기존 Ledger 편집 command 외 업무를 접수하지 않는다`() = runTest {
        val store = MemoryStore()
        val outbox = QuickEditCommandOutbox(store)
        val unrelated = HouseholdCommandEnvelopeV1(
            commandId = "android:unrelated",
            idempotencyKey = "android-quick-edit:unrelated",
            householdId = scope.householdId,
            command = HouseholdCommandKind.REGISTER_NOTIFICATION_ENDPOINT,
            payload = emptyMap()
        )

        assertFalse(outbox.enqueue(scope, "transaction-1", unrelated))
        assertTrue(store.entries.isEmpty())
    }

    private fun envelope(
        operationId: String,
        transactionId: String = "transaction-1"
    ) = HouseholdCommandEnvelopeV1.create(
        householdId = scope.householdId,
        command = HouseholdCommandKind.UPDATE,
        payload = mapOf(
            "transactionId" to transactionId,
            "expectedVersion" to 3,
            "patch" to mapOf("memo" to "수정 메모")
        ),
        operationId = operationId
    )
}
