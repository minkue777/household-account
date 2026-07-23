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
            override suspend fun submit(envelope: CaptureDeliveryEnvelope) = CaptureSubmissionReceipt(
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
            override suspend fun submit(envelope: CaptureDeliveryEnvelope): CaptureSubmissionReceipt {
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
            override suspend fun submit(envelope: CaptureDeliveryEnvelope): CaptureSubmissionReceipt {
                calls++
                error("호출되면 안 됩니다")
            }
        })

        assertEquals(0, calls)
        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `원문 envelope는 서버 completion이 terminal이면 parser 결과가 없어도 제거한다`() = runTest {
        val store = MemoryStore()
        val queue = CaptureDeliveryQueue(store) { 1_000L }
        queue.enqueue(scope, rawEnvelope())

        queue.flush(scope, object : CaptureSubmissionClient {
            override suspend fun submit(envelope: CaptureDeliveryEnvelope) =
                CaptureSubmissionReceipt("terminal", null, null)
        })

        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `원문 envelope의 일부 branch가 재시도 가능하면 유지하고 Quick Edit은 한 번만 만든다`() = runTest {
        val store = MemoryStore()
        val queue = CaptureDeliveryQueue(store) { 1_000L }
        queue.enqueue(scope, rawEnvelope())
        val partial = object : CaptureSubmissionClient {
            override suspend fun submit(envelope: CaptureDeliveryEnvelope) = CaptureSubmissionReceipt(
                completion = "partial-retryable",
                transaction = CaptureBranchReceipt("created", "transaction-raw", 4),
                balance = CaptureBranchReceipt("retryableFailure", retryable = true)
            )
        }

        val first = queue.flush(scope, partial)
        val second = queue.flush(scope, partial)

        assertEquals(listOf("transaction-raw"), first.followUps.map { it.transactionId })
        assertTrue(second.followUps.isEmpty())
        assertEquals(1, store.entries.size)
    }

    @Test
    fun `직접 제출 receipt는 Quick Edit snapshot을 전달하고 partial branch만 재시도 대상으로 판정한다`() {
        val snapshot = CaptureQuickEditSnapshot(
            transactionId = "transaction-fast",
            merchant = "빠른가맹점",
            amountInWon = 12_000,
            accountingDate = "2026-07-23",
            localTime = "19:10",
            categoryId = "food",
            memo = "",
            aggregateVersion = 3
        )

        val decision = evaluateCaptureReceipt(
            envelope = rawEnvelope(),
            receipt = CaptureSubmissionReceipt(
                completion = "partial-retryable",
                transaction = CaptureBranchReceipt(
                    kind = "created",
                    resourceId = "transaction-fast",
                    aggregateVersion = 3,
                    quickEditSnapshot = snapshot
                ),
                balance = CaptureBranchReceipt(
                    kind = "retryableFailure",
                    retryable = true
                )
            )
        )

        assertEquals(snapshot, decision.followUps.single().quickEditSnapshot)
        assertEquals(setOf(CaptureBranch.PAYMENT), decision.terminalBranches)
        assertTrue(!decision.completed)
    }

    @Test
    fun `terminal 직접 제출은 암호화 재시도 Queue가 필요하지 않다`() {
        val decision = evaluateCaptureReceipt(
            envelope = rawEnvelope(),
            receipt = CaptureSubmissionReceipt(
                completion = "terminal",
                transaction = CaptureBranchReceipt(
                    kind = "created",
                    resourceId = "transaction-fast",
                    aggregateVersion = 1
                ),
                balance = null
            )
        )

        assertTrue(decision.completed)
        assertEquals(listOf("transaction-fast"), decision.followUps.map { it.transactionId })
    }

    @Test
    fun `Quick Edit 후속효과를 내구화한 뒤에만 terminal capture를 제거한다`() = runTest {
        val store = MemoryStore()
        val queue = CaptureDeliveryQueue(store) { 1_000L }
        queue.enqueue(scope, rawEnvelope())
        var callbackObservedJournal = false

        queue.flush(
            currentScope = scope,
            client = object : CaptureSubmissionClient {
                override suspend fun submit(envelope: CaptureDeliveryEnvelope) =
                    CaptureSubmissionReceipt(
                        completion = "terminal",
                        transaction = CaptureBranchReceipt(
                            kind = "created",
                            resourceId = "transaction-fast",
                            aggregateVersion = 1
                        ),
                        balance = null
                    )
            },
            beforeCommitFollowUps = {
                callbackObservedJournal = store.entries.isNotEmpty()
            }
        )

        assertTrue(callbackObservedJournal)
        assertTrue(store.entries.isEmpty())
    }

    @Test
    fun `Quick Edit 후속효과 내구화가 실패하면 capture journal을 보존한다`() = runTest {
        val store = MemoryStore()
        val queue = CaptureDeliveryQueue(store) { 1_000L }
        queue.enqueue(scope, rawEnvelope())

        runCatching {
            queue.flush(
                currentScope = scope,
                client = object : CaptureSubmissionClient {
                    override suspend fun submit(envelope: CaptureDeliveryEnvelope) =
                        CaptureSubmissionReceipt(
                            completion = "terminal",
                            transaction = CaptureBranchReceipt(
                                kind = "created",
                                resourceId = "transaction-fast",
                                aggregateVersion = 1
                            ),
                            balance = null
                        )
                },
                beforeCommitFollowUps = { error("QUICK_EDIT_QUEUE_UNAVAILABLE") }
            )
        }

        assertEquals(1, store.entries.size)
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

    private fun rawEnvelope() = RawNotificationEnvelopeV1(
        observationId = "observation.android.rawtest",
        packageName = "com.samsung.android.messaging",
        notification = RawNotificationContentV1(
            postedAt = "2026-07-22T17:41:00+09:00",
            title = "문자 메시지",
            textLines = listOf("삼성1876승인", "20,300원")
        )
    )
}
