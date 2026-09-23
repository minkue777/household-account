package com.household.account.paymentcapture

import com.household.account.server.AuthenticatedCallableGateway
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureSubmissionClientTest {
    @Test
    fun `snapshot 태그는 그대로 전달하고 구버전 누락과 손상 fallback을 구분한다`() = runTest {
        suspend fun snapshot(tags: Map<String, Any?>): CaptureQuickEditSnapshot? {
            val client = CallableCaptureSubmissionClient(gateway(mapOf("result" to mapOf(
                "completion" to "terminal", "transactionResult" to mapOf(
                    "kind" to "created", "transactionId" to "transaction-1", "aggregateVersion" to 1,
                    "quickEditSnapshot" to (mapOf(
                        "transactionId" to "transaction-1", "merchant" to "상점", "amountInWon" to 1000,
                        "accountingDate" to "2026-09-23", "localTime" to "12:00",
                        "categoryId" to "etc", "memo" to "", "aggregateVersion" to 1
                    ) + tags)
                )
            ))))
            return client.submit(envelope()).transaction?.quickEditSnapshot
        }
        val tags = listOf("2026부산여행", "가족 모임")
        assertEquals(tags, snapshot(mapOf("tags" to tags))?.tags)
        assertEquals(emptyList<String>(), snapshot(emptyMap())?.tags)
        assertEquals(emptyList<String>(), snapshot(mapOf("tags" to emptyList<String>()))?.tags)
        for (invalid in listOf(null, "여행", listOf("여행", 123))) {
            assertEquals(null, snapshot(mapOf("tags" to invalid)))
        }
    }

    @Test
    fun `원문과 레거시 envelope를 각각 호환되는 callable로 전송한다`() = runTest {
        val functions = mutableListOf<String>()
        val gateway = object : AuthenticatedCallableGateway {
            override suspend fun call(
                functionName: String,
                payload: Map<String, Any?>
            ): Map<String, Any?> {
                functions += functionName
                return mapOf("result" to mapOf("completion" to "terminal"))
            }
        }
        val client = CallableCaptureSubmissionClient(gateway)

        client.submit(rawEnvelope())
        client.submit(envelope())

        assertEquals(
            listOf("submitAndroidRawNotification", "submitCaptureEnvelope"),
            functions
        )
    }

    @Test
    fun `created receipt는 transaction id와 aggregate version을 모두 요구한다`() = runTest {
        val responseWithoutVersion = mapOf<String, Any?>(
            "result" to mapOf(
                "completion" to "terminal",
                "transactionResult" to mapOf(
                    "kind" to "created",
                    "transactionId" to "transaction-1"
                )
            )
        )
        val client = CallableCaptureSubmissionClient(gateway(responseWithoutVersion))

        var contractFailure = false
        try {
            client.submit(envelope())
        } catch (_: CaptureSubmissionContractException) {
            contractFailure = true
        }
        assertTrue(contractFailure)
    }

    @Test
    fun `created receipt의 서버 aggregate version을 그대로 보존한다`() = runTest {
        val client = CallableCaptureSubmissionClient(gateway(mapOf(
            "result" to mapOf(
                "completion" to "terminal",
                "transactionResult" to mapOf(
                    "kind" to "created",
                    "transactionId" to "transaction-1",
                    "aggregateVersion" to 7
                )
            )
        )))

        assertEquals(7, client.submit(envelope()).transaction?.aggregateVersion)
    }

    @Test
    fun `created receipt의 Quick Edit snapshot을 전체 필드와 함께 보존한다`() = runTest {
        val client = CallableCaptureSubmissionClient(gateway(mapOf(
            "result" to mapOf(
                "completion" to "terminal",
                "transactionResult" to mapOf(
                    "kind" to "created",
                    "transactionId" to "transaction-1",
                    "aggregateVersion" to 7,
                    "quickEditSnapshot" to mapOf(
                        "transactionId" to "transaction-1",
                        "merchant" to "동탄상점",
                        "amountInWon" to 20_300,
                        "accountingDate" to "2026-07-23",
                        "localTime" to "18:20",
                        "categoryId" to "etc",
                        "memo" to "",
                        "aggregateVersion" to 7
                    )
                )
            )
        )))

        assertEquals(
            CaptureQuickEditSnapshot(
                transactionId = "transaction-1",
                merchant = "동탄상점",
                amountInWon = 20_300,
                accountingDate = "2026-07-23",
                localTime = "18:20",
                categoryId = "etc",
                memo = "",
                aggregateVersion = 7
            ),
            client.submit(envelope()).transaction?.quickEditSnapshot
        )
    }

    @Test
    fun `없거나 불완전한 Quick Edit snapshot은 거래 접수를 실패시키지 않고 조회 fallback을 사용한다`() =
        runTest {
            val client = CallableCaptureSubmissionClient(gateway(mapOf(
                "result" to mapOf(
                    "completion" to "terminal",
                    "transactionResult" to mapOf(
                        "kind" to "created",
                        "transactionId" to "transaction-1",
                        "aggregateVersion" to 1,
                        "quickEditSnapshot" to mapOf(
                            "transactionId" to "transaction-1",
                            "merchant" to "가맹점"
                        )
                    )
                )
            )))

            assertEquals(null, client.submit(envelope()).transaction?.quickEditSnapshot)
        }

    private fun gateway(response: Map<String, Any?>) = object : AuthenticatedCallableGateway {
        override suspend fun call(
            functionName: String,
            payload: Map<String, Any?>
        ): Map<String, Any?> = response
    }

    private fun envelope() = CaptureEnvelopeV1(
        observationId = "observation.android.contract",
        sourceEvidence = AndroidRegisteredPackageEvidence("kb", "com.kbcard.cxh.appcard"),
        observedAt = "2026-07-21T10:00:00+09:00",
        parser = ParserEvidenceV1("kb-parser", "1.0.0"),
        rawPayloadHash = "sha256:" + "a".repeat(64),
        paymentObservation = PaymentObservationV1(
            branchId = "branch.payment",
            observationType = "approval",
            amountInWon = 1000,
            occurredLocalDate = "2026-07-21",
            occurredLocalTime = "10:00",
            merchantCandidate = "가맹점",
            cardEvidence = CardEvidenceV1("국민카드", "1234")
        )
    )

    private fun rawEnvelope() = RawNotificationEnvelopeV1(
        observationId = "observation.android.rawcontract",
        packageName = "com.samsung.android.messaging",
        notification = RawNotificationContentV1(
            postedAt = "2026-07-22T17:41:00+09:00",
            text = "삼성1876승인 20,300원"
        )
    )
}
