package com.household.account.quickedit

import com.household.account.ledger.HouseholdCommandClient
import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.ledger.HouseholdCommandResult
import com.household.account.paymentcapture.CaptureSessionScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class QuickEditUpdateFeedbackTest {
    private class Store : QuickEditCommandOutboxStore {
        var entries = emptyList<QuickEditCommandOutboxEntry>()
        var failWrite = false
        override fun load() = entries
        override fun replace(entries: List<QuickEditCommandOutboxEntry>) {
            check(!failWrite)
            this.entries = entries
        }
        override fun clear() { entries = emptyList() }
    }
    private val scope = CaptureSessionScope("home", "member", 8)
    private fun envelope(id: String = "one", kind: HouseholdCommandKind = HouseholdCommandKind.UPDATE) =
        HouseholdCommandEnvelopeV1.create("home", kind, mapOf(
            "transactionId" to "expense", "expectedVersion" to 3,
            "patch" to mapOf("memo" to "changed", "tags" to listOf("trip"))
        ), id)
    private val canonical = mapOf<String, Any?>("transactionId" to "expense", "householdId" to "home", "aggregateVersion" to 4, "memo" to "changed")
    private fun client(result: HouseholdCommandResult) = object : HouseholdCommandClient {
        override suspend fun execute(envelope: HouseholdCommandEnvelopeV1) = result
    }

    @Test fun `영속 예약 전에는 pending을 노출하지 않고 접수 뒤 정확한 patch를 한 번 제공한다`() = runTest {
        val outbox = QuickEditCommandOutbox(Store())
        val command = envelope()
        outbox.enqueue(scope, "expense", command)
        assertTrue(outbox.updateFeedback(scope).isEmpty())
        assertEquals(0L, outbox.updateFeedbackChanges.value)
        outbox.acceptUpdateFeedback(scope, command.commandId)
        val revision = outbox.updateFeedbackChanges.value
        outbox.acceptUpdateFeedback(scope, command.commandId)
        assertEquals(revision, outbox.updateFeedbackChanges.value)
        assertEquals(listOf(QuickEditUpdateFeedback(command.commandId, "expense", 3,
            mapOf("memo" to "changed", "tags" to listOf("trip")), "pending")), outbox.updateFeedback(scope))
    }

    @Test fun `서버 지연 중 pending이고 성공 삭제 뒤에도 canonical이 빈 구간 없이 남는다`() = runTest {
        val store = Store()
        val outbox = QuickEditCommandOutbox(store)
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        outbox.enqueue(scope, "expense", envelope())
        val flushing = async { outbox.flush(scope, object : HouseholdCommandClient {
            override suspend fun execute(envelope: HouseholdCommandEnvelopeV1): HouseholdCommandResult {
                started.complete(Unit); release.await()
                return HouseholdCommandResult.Succeeded(canonical)
            }
        }) }
        started.await()
        assertEquals("pending", outbox.updateFeedback(scope).single().state)
        release.complete(Unit); flushing.await()
        assertTrue(store.entries.isEmpty())
        assertEquals("succeeded", outbox.updateFeedback(scope).single().state)
        assertEquals(canonical, outbox.updateFeedback(scope).single().transaction)
        assertTrue(QuickEditCommandOutbox(store).updateFeedback(scope).isEmpty())
    }

    @Test fun `프로세스 재시작 pending은 복구 예약 성공 후 기존 patch로 다시 노출한다`() = runTest {
        val store = Store()
        QuickEditCommandOutbox(store).enqueue(scope, "expense", envelope())
        val restored = QuickEditCommandOutbox(store)
        assertTrue(restored.updateFeedback(scope).isEmpty())
        restored.acceptUpdateFeedback(scope)
        assertEquals("pending", restored.updateFeedback(scope).single().state)
    }

    @Test fun `성공 outbox 삭제가 실패하면 pending과 기존 영속 envelope를 유지한다`() = runTest {
        val store = Store()
        val outbox = QuickEditCommandOutbox(store)
        outbox.enqueue(scope, "expense", envelope())
        store.failWrite = true
        try { outbox.flush(scope, client(HouseholdCommandResult.Succeeded(canonical))); fail("storage failure expected") } catch (_: IllegalStateException) { }
        assertEquals("pending", outbox.updateFeedback(scope).single().state)
        assertEquals(1, store.entries.size)
    }

    @Test fun `최종 실패는 알림 전달 뒤에도 rollback 피드백을 유지하고 일시 실패는 pending이다`() = runTest {
        for (result in listOf(HouseholdCommandResult.Conflict(4), HouseholdCommandResult.Rejected("INVALID"), HouseholdCommandResult.ContractFailure("INVALID_RESPONSE"))) {
            val outbox = QuickEditCommandOutbox(Store())
            val command = envelope()
            outbox.enqueue(scope, "expense", command)
            outbox.flush(scope, client(result))
            outbox.markFailureNotificationDelivered(command.commandId)
            assertTrue(outbox.snapshot().isEmpty())
            assertEquals("failed", outbox.updateFeedback(scope).single().state)
            assertNull(outbox.updateFeedback(scope).single().transaction)
        }
        val outbox = QuickEditCommandOutbox(Store())
        outbox.enqueue(scope, "expense", envelope())
        outbox.flush(scope, client(HouseholdCommandResult.RetryableFailure("OFFLINE")))
        assertEquals("pending", outbox.updateFeedback(scope).single().state)
    }

    @Test fun `ack는 같은 native session의 완료 결과만 제거하고 pending은 유지한다`() = runTest {
        val outbox = QuickEditCommandOutbox(Store())
        val command = envelope()
        outbox.enqueue(scope, "expense", command)
        outbox.acceptUpdateFeedback(scope)
        outbox.acknowledgeUpdateFeedback(scope, setOf(command.commandId))
        assertEquals("pending", outbox.updateFeedback(scope).single().state)
        outbox.flush(scope, client(HouseholdCommandResult.Succeeded(canonical)))
        val changedSession = scope.copy(sessionGeneration = 9)
        outbox.acknowledgeUpdateFeedback(changedSession, setOf(command.commandId))
        assertTrue(outbox.updateFeedback(changedSession).isEmpty())
        assertEquals("succeeded", outbox.updateFeedback(scope).single().state)
        outbox.acknowledgeUpdateFeedback(scope, setOf(command.commandId))
        assertTrue(outbox.updateFeedback(scope).isEmpty())
    }

    @Test fun `진행 중 네트워크 뒤 세션 purge는 늦은 완료 결과와 pending을 함께 지운다`() = runTest {
        val outbox = QuickEditCommandOutbox(Store())
        val started = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        outbox.enqueue(scope, "expense", envelope())
        val flushing = async { outbox.flush(scope, object : HouseholdCommandClient {
            override suspend fun execute(envelope: HouseholdCommandEnvelopeV1): HouseholdCommandResult {
                started.complete(Unit); release.await()
                return HouseholdCommandResult.Succeeded(canonical)
            }
        }) }
        started.await()
        val purge = async { outbox.purgeForSessionTransition() }
        release.complete(Unit); flushing.await(); purge.await()
        assertTrue(outbox.updateFeedback(scope).isEmpty())
        assertTrue(outbox.snapshot().isEmpty())
    }

    @Test fun `같은 원장의 후행 삭제나 분할 성공은 과거 수정 canonical을 제거한다`() = runTest {
        for (kind in listOf(HouseholdCommandKind.DELETE, HouseholdCommandKind.SPLIT)) {
            val outbox = QuickEditCommandOutbox(Store())
            outbox.enqueue(scope, "expense", envelope())
            outbox.flush(scope, client(HouseholdCommandResult.Succeeded(canonical)))
            outbox.enqueue(scope, "expense", envelope("later", kind))
            outbox.flush(scope, client(HouseholdCommandResult.Succeeded(emptyMap<String, Any?>())))
            assertTrue(outbox.updateFeedback(scope).isEmpty())
        }
    }

    @Test fun `완료 인계 전 더 새로운 pending이 생겨도 완료 다음에 pending을 제공한다`() = runTest {
        val outbox = QuickEditCommandOutbox(Store())
        outbox.enqueue(scope, "expense", envelope())
        outbox.flush(scope, client(HouseholdCommandResult.Succeeded(canonical)))
        outbox.enqueue(scope, "expense", envelope("next"))
        outbox.acceptUpdateFeedback(scope)
        assertEquals(listOf("succeeded", "pending"), outbox.updateFeedback(scope).map { it.state })
    }

    @Test fun `미인계 완료 메모리에는 개수와 기존 72시간 보존 상한이 적용된다`() = runTest {
        var now = 100L
        val outbox = QuickEditCommandOutbox(Store()) { now }
        repeat(257) { index ->
            outbox.enqueue(scope, "expense", envelope("item-$index"))
            outbox.flush(scope, client(HouseholdCommandResult.Succeeded(canonical)))
        }
        assertEquals(256, outbox.updateFeedback(scope).size)
        assertFalse(outbox.updateFeedback(scope).any { it.commandId == "android:item-0" })
        now += QuickEditCommandOutbox.MAX_RETRY_WINDOW_MILLIS
        assertTrue(outbox.updateFeedback(scope).isEmpty())
    }
}
