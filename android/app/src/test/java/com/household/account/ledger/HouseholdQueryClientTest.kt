package com.household.account.ledger

import com.household.account.server.AuthenticatedCallableGateway
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HouseholdQueryClientTest {
    @Test
    fun `정본 query wire를 보내고 succeeded snapshot을 해석한다`() = runTest {
        var sent = emptyMap<String, Any?>()
        val client = CallableLedgerTransactionQueryClient(object : AuthenticatedCallableGateway {
            override suspend fun call(
                functionName: String,
                payload: Map<String, Any?>
            ): Map<String, Any?> {
                sent = payload
                return mapOf(
                    "contractVersion" to "household-query-response.v1",
                    "queryId" to payload["queryId"],
                    "result" to mapOf(
                        "kind" to "succeeded",
                        "value" to mapOf(
                            "transactionId" to "transaction-1",
                            "aggregateVersion" to 3,
                            "lifecycleState" to "active",
                            "transactionType" to "expense",
                            "amountInWon" to 12_000,
                            "accountingDate" to "2026-07-21",
                            "merchant" to "식료품점",
                            "categoryId" to "category-food"
                        )
                    )
                )
            }
        })

        val result = client.get("household-1", "transaction-1")

        assertTrue(result is LedgerTransactionQueryResult.Success)
        assertEquals("household-query.v1", sent["contractVersion"])
        assertEquals("ledger.get-transaction.v1", sent["query"])
        assertEquals("transaction-1", (result as LedgerTransactionQueryResult.Success).value.transactionId)
    }

    @Test
    fun `rejected error의 NOT_FOUND와 retryable을 서로 축약하지 않는다`() = runTest {
        suspend fun query(code: String, retryable: Boolean): LedgerTransactionQueryResult {
            return CallableLedgerTransactionQueryClient(object : AuthenticatedCallableGateway {
                override suspend fun call(
                    functionName: String,
                    payload: Map<String, Any?>
                ): Map<String, Any?> = mapOf(
                    "contractVersion" to "household-query-response.v1",
                    "queryId" to payload["queryId"],
                    "result" to mapOf(
                        "kind" to "rejected",
                        "error" to mapOf("code" to code, "retryable" to retryable)
                    )
                )
            }).get("household-1", "transaction-1")
        }

        assertEquals(LedgerTransactionQueryResult.NotFound, query("NOT_FOUND", false))
        assertTrue(query("UNAVAILABLE", true) is LedgerTransactionQueryResult.RetryableFailure)
        assertTrue(query("BAD_CONTRACT", false) is LedgerTransactionQueryResult.ContractFailure)
    }

    @Test
    fun `다른 query id나 transaction id 응답은 현재 거래로 열지 않는다`() = runTest {
        suspend fun query(
            responseQueryId: (Map<String, Any?>) -> Any?,
            responseTransactionId: String
        ): LedgerTransactionQueryResult = CallableLedgerTransactionQueryClient(
            object : AuthenticatedCallableGateway {
                override suspend fun call(
                    functionName: String,
                    payload: Map<String, Any?>
                ): Map<String, Any?> = mapOf(
                    "contractVersion" to "household-query-response.v1",
                    "queryId" to responseQueryId(payload),
                    "result" to mapOf(
                        "kind" to "succeeded",
                        "value" to mapOf(
                            "transactionId" to responseTransactionId,
                            "aggregateVersion" to 1,
                            "lifecycleState" to "active",
                            "transactionType" to "expense",
                            "amountInWon" to 1000,
                            "accountingDate" to "2026-07-21"
                        )
                    )
                )
            }
        ).get("household-1", "transaction-1")

        assertEquals(
            LedgerTransactionQueryResult.ContractFailure("QUERY_ID_MISMATCH"),
            query({ "another-query" }, "transaction-1")
        )
        assertEquals(
            LedgerTransactionQueryResult.ContractFailure("QUERY_VALUE_INVALID"),
            query({ payload -> payload["queryId"] }, "transaction-2")
        )
    }
}
