package com.household.account.paymentcapture

import com.household.account.server.AuthenticatedCallableGateway
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureSubmissionClientTest {
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
