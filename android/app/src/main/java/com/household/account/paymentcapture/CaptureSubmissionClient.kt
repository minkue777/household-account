package com.household.account.paymentcapture

import com.household.account.server.AuthenticatedCallableGateway

data class CaptureBranchReceipt(
    val kind: String,
    val resourceId: String? = null,
    val aggregateVersion: Int? = null,
    val retryable: Boolean = false
)

data class CaptureSubmissionReceipt(
    val completion: String,
    val transaction: CaptureBranchReceipt?,
    val balance: CaptureBranchReceipt?
)

interface CaptureSubmissionClient {
    suspend fun submit(envelope: CaptureEnvelopeV1): CaptureSubmissionReceipt
}

class CallableCaptureSubmissionClient(
    private val gateway: AuthenticatedCallableGateway
) : CaptureSubmissionClient {

    override suspend fun submit(envelope: CaptureEnvelopeV1): CaptureSubmissionReceipt {
        val response = gateway.call(FUNCTION_NAME, envelope.toMap())
        val result = response.objectValue("result") ?: response
        val transaction = result.objectValue("transactionResult")?.toReceipt(transactionBranch = true)
        val balance = result.objectValue("balanceResult")?.toReceipt(transactionBranch = false)

        return CaptureSubmissionReceipt(
            completion = result["completion"]?.toString() ?: inferCompletion(transaction, balance),
            transaction = transaction,
            balance = balance
        )
    }

    private fun inferCompletion(
        transaction: CaptureBranchReceipt?,
        balance: CaptureBranchReceipt?
    ): String = if (transaction?.retryable == true || balance?.retryable == true) {
        "partial-retryable"
    } else {
        "terminal"
    }

    private fun Map<String, Any?>.toReceipt(transactionBranch: Boolean): CaptureBranchReceipt {
        val kind = this["kind"]?.toString().orEmpty()
        val retryable = kind == "retryableFailure" || kind == "retryable-failure" ||
            kind == "RetryableFailure"
        val resourceId = when {
            !transactionBranch -> this["balanceId"]?.toString()
            kind.equals("duplicate", ignoreCase = true) -> this["existingTransactionId"]?.toString()
            else -> this["transactionId"]?.toString()
        }
        val version = (this["aggregateVersion"] as? Number)?.toInt()
            ?: (this["transactionVersion"] as? Number)?.toInt()

        if (
            transactionBranch &&
            kind.equals("created", ignoreCase = true) &&
            (resourceId.isNullOrBlank() || version == null || version < 1)
        ) {
            throw CaptureSubmissionContractException("CREATED_TRANSACTION_RECEIPT_INVALID")
        }

        return CaptureBranchReceipt(kind, resourceId, version, retryable)
    }

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.objectValue(key: String): Map<String, Any?>? =
        this[key] as? Map<String, Any?>

    companion object {
        const val FUNCTION_NAME = "submitCaptureEnvelope"
    }
}

class CaptureSubmissionContractException(code: String) : IllegalStateException(code)
