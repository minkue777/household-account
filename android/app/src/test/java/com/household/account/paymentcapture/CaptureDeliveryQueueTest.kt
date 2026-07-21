package com.household.account.paymentcapture

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureDeliveryQueueTest {
    private class MemoryStore : CaptureQueueStore {
        var entries = emptyList<QueuedCapture>()
        override fun load(): List<QueuedCapture> = entries
        override fun replace(entries: List<QueuedCapture>) {
            this.entries = entries
        }
        override fun clear() {
            entries = emptyList()
        }
    }

    private val scope = CaptureSessionScope("household-1", "member-1", 3L)

    @Test
    fun `payment 성공과 balance 재시도는 성공 후속효과를 한번만 만들고 entry를 유지한다`() = runTest {
        val store = MemoryStore()
        val queue = CaptureDeliveryQueue(store) { 1_000L }
        queue.enqueue(scope, combinedEnvelope())

        val partial = object : CaptureSubmissionClient {
            override suspend fun submit(envelope: CaptureEnvelopeV1) = CaptureSubmissionReceipt(
                completion = "partial-retryable",
                transaction = CaptureBranchReceipt("created", "transaction-1", 2, false),
                balance = CaptureBranchReceipt("retryableFailure", retryable = true)
            )
        }

        val first = queue.flush(scope, partial)
        val second = queue.flush(scope, partial)

        assertEquals(listOf("transaction-1"), first.followUps.map { it.transactionId })
        assertTrue(second.followUps.isEmpty())
        assertEquals(setOf(CaptureBranch.PAYMENT), store.entries.single().terminalBranches)
    }

    @Test
    fun `모든 branch가 terminal이면 삭제하고 다른 session entry는 제출하지 않는다`() = runTest {
        val store = MemoryStore()
        val queue = CaptureDeliveryQueue(store) { 1_000L }
        queue.enqueue(scope, combinedEnvelope())
        var calls = 0
        val terminal = object : CaptureSubmissionClient {
            override suspend fun submit(envelope: CaptureEnvelopeV1): CaptureSubmissionReceipt {
                calls++
                return CaptureSubmissionReceipt(
                    "terminal",
                    CaptureBranchReceipt("created", "transaction-1", 1),
                    CaptureBranchReceipt("recorded", "balance-1")
                )
            }
        }

        queue.flush(CaptureSessionScope("household-2", "member-2", 4L), terminal)

        assertEquals(0, calls)
        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `72시간을 넘긴 entry는 서버에 보내지 않고 삭제한다`() = runTest {
        val store = MemoryStore()
        var now = 1_000L
        val queue = CaptureDeliveryQueue(store) { now }
        queue.enqueue(scope, combinedEnvelope())
        now += CaptureDeliveryQueue.MAX_RETENTION_MILLIS + 1L
        var calls = 0

        queue.flush(scope, object : CaptureSubmissionClient {
            override suspend fun submit(envelope: CaptureEnvelopeV1): CaptureSubmissionReceipt {
                calls++
                error("호출되면 안 됩니다")
            }
        })

        assertEquals(0, calls)
        assertTrue(store.entries.isEmpty())
    }

    private fun combinedEnvelope() = CaptureEnvelopeV1(
        observationId = "observation.android.test",
        sourceEvidence = AndroidRegisteredPackageEvidence(
            "gyeonggi-local-currency",
            "gov.gyeonggi.ggcard"
        ),
        observedAt = "2026-07-19T11:01:00+09:00",
        parser = ParserEvidenceV1("gyeonggi-local-currency-parser", "1.0.0"),
        rawPayloadHash = "sha256:" + "1".repeat(64),
        paymentObservation = PaymentObservationV1(
            branchId = "branch.payment",
            observationType = "approval",
            amountInWon = 5_000,
            occurredLocalDate = "2026-07-19",
            occurredLocalTime = "11:01",
            merchantCandidate = "가맹점 B",
            cardEvidence = CardEvidenceV1("경기지역화폐", "5678"),
            localCurrencyType = "gyeonggi"
        ),
        balanceObservation = BalanceObservationV1(
            "branch.balance",
            "gyeonggi",
            83_000,
            "2026-07-19T11:01:00+09:00"
        )
    )
}
