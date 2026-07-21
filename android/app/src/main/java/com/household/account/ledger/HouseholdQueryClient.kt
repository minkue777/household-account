package com.household.account.ledger

import com.household.account.server.AuthenticatedCallableGateway
import java.util.UUID

data class LedgerTransactionSnapshot(
    val transactionId: String,
    val aggregateVersion: Int,
    val lifecycleState: String,
    val transactionType: String,
    val amountInWon: Int,
    val accountingDate: String,
    val localTime: String,
    val merchant: String,
    val categoryId: String,
    val memo: String
)

sealed interface LedgerTransactionQueryResult {
    data class Success(val value: LedgerTransactionSnapshot) : LedgerTransactionQueryResult
    data object NotFound : LedgerTransactionQueryResult
    data object Forbidden : LedgerTransactionQueryResult
    data class ContractFailure(val code: String) : LedgerTransactionQueryResult
    data class RetryableFailure(val code: String) : LedgerTransactionQueryResult
}

interface LedgerTransactionQueryClient {
    suspend fun get(householdId: String, transactionId: String): LedgerTransactionQueryResult
}

class CallableLedgerTransactionQueryClient(
    private val gateway: AuthenticatedCallableGateway
) : LedgerTransactionQueryClient {
    override suspend fun get(
        householdId: String,
        transactionId: String
    ): LedgerTransactionQueryResult {
        if (householdId.isBlank() || transactionId.isBlank()) {
            return LedgerTransactionQueryResult.ContractFailure("QUERY_SCOPE_REQUIRED")
        }
        val queryId = "android:${UUID.randomUUID()}"
        val response = try {
            gateway.call(
                FUNCTION_NAME,
                mapOf(
                    "contractVersion" to "household-query.v1",
                    "queryId" to queryId,
                    "householdId" to householdId,
                    "query" to QUERY_NAME,
                    "payload" to mapOf("transactionId" to transactionId)
                )
            )
        } catch (_: Exception) {
            return LedgerTransactionQueryResult.RetryableFailure("SERVER_UNAVAILABLE")
        }

        if (response["contractVersion"] != "household-query-response.v1") {
            return LedgerTransactionQueryResult.ContractFailure("INVALID_RESPONSE_VERSION")
        }
        if (response["queryId"] != queryId) {
            return LedgerTransactionQueryResult.ContractFailure("QUERY_ID_MISMATCH")
        }

        val result = response.objectValue("result") ?: response
        return when (result["kind"]?.toString()?.lowercase()) {
            "succeeded", "already-processed" -> decodeSuccess(result, transactionId)
            "rejected" -> decodeRejection(result)
            else -> LedgerTransactionQueryResult.ContractFailure("INVALID_QUERY_RESPONSE")
        }
    }

    private fun decodeRejection(result: Map<String, Any?>): LedgerTransactionQueryResult {
        val error = result.objectValue("error")
            ?: return LedgerTransactionQueryResult.ContractFailure("QUERY_ERROR_MISSING")
        val code = error["code"]?.toString().orEmpty()
        val retryable = error["retryable"] as? Boolean
            ?: return LedgerTransactionQueryResult.ContractFailure("QUERY_ERROR_INVALID")
        if (retryable) return LedgerTransactionQueryResult.RetryableFailure(code)

        return when (code) {
            "NOT_FOUND" -> LedgerTransactionQueryResult.NotFound
            "FORBIDDEN" -> LedgerTransactionQueryResult.Forbidden
            else -> LedgerTransactionQueryResult.ContractFailure(code.ifBlank { "QUERY_REJECTED" })
        }
    }

    private fun decodeSuccess(
        result: Map<String, Any?>,
        expectedTransactionId: String
    ): LedgerTransactionQueryResult {
        val value = result.objectValue("value")
            ?: return LedgerTransactionQueryResult.ContractFailure("QUERY_VALUE_MISSING")
        val transactionId = value["transactionId"]?.toString().orEmpty()
        val amount = (value["amountInWon"] as? Number)?.toInt()
        val version = (value["aggregateVersion"] as? Number)?.toInt()
        val lifecycleState = value["lifecycleState"]?.toString().orEmpty()
        val transactionType = value["transactionType"]?.toString().orEmpty()
        val accountingDate = value["accountingDate"]?.toString().orEmpty()
        if (
            transactionId != expectedTransactionId ||
            amount == null ||
            version == null ||
            lifecycleState.isBlank() ||
            transactionType.isBlank() ||
            accountingDate.isBlank()
        ) {
            return LedgerTransactionQueryResult.ContractFailure("QUERY_VALUE_INVALID")
        }

        return LedgerTransactionQueryResult.Success(
            LedgerTransactionSnapshot(
                transactionId = transactionId,
                aggregateVersion = version,
                lifecycleState = lifecycleState,
                transactionType = transactionType,
                amountInWon = amount,
                accountingDate = accountingDate,
                localTime = value["localTime"]?.toString().orEmpty(),
                merchant = value["merchant"]?.toString()
                    ?: value["itemName"]?.toString().orEmpty(),
                categoryId = value["categoryId"]?.toString().orEmpty(),
                memo = value["memo"]?.toString().orEmpty()
            )
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.objectValue(key: String): Map<String, Any?>? =
        this[key] as? Map<String, Any?>

    companion object {
        const val FUNCTION_NAME = "executeHouseholdQuery"
        const val QUERY_NAME = "ledger.get-transaction.v1"
    }
}
