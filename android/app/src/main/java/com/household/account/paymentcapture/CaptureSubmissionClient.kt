package com.household.account.paymentcapture

import com.household.account.server.AuthenticatedCallableGateway

data class CaptureBranchReceipt(
    val kind: String,
    val resourceId: String? = null,
    val aggregateVersion: Int? = null,
    val retryable: Boolean = false,
    val quickEditSnapshot: CaptureQuickEditSnapshot? = null
)

data class CaptureSubmissionReceipt(
    val completion: String,
    val transaction: CaptureBranchReceipt?,
    val balance: CaptureBranchReceipt?
)

interface CaptureSubmissionClient {
    suspend fun submit(envelope: CaptureDeliveryEnvelope): CaptureSubmissionReceipt
}

class CallableCaptureSubmissionClient(
    private val gateway: AuthenticatedCallableGateway
) : CaptureSubmissionClient {

    override suspend fun submit(envelope: CaptureDeliveryEnvelope): CaptureSubmissionReceipt {
        val functionName = when (envelope) {
            is RawNotificationEnvelopeV1 -> RAW_NOTIFICATION_FUNCTION_NAME
            is CaptureEnvelopeV1 -> LEGACY_ENVELOPE_FUNCTION_NAME
        }
        val response = gateway.call(functionName, envelope.toMap())
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

        val quickEditSnapshot = if (
            transactionBranch &&
            kind.equals("created", ignoreCase = true)
        ) {
            objectValue("quickEditSnapshot")
                ?.toQuickEditSnapshot()
                ?.takeIf {
                    it.transactionId == resourceId &&
                        it.aggregateVersion == version
                }
        } else {
            null
        }

        return CaptureBranchReceipt(
            kind = kind,
            resourceId = resourceId,
            aggregateVersion = version,
            retryable = retryable,
            quickEditSnapshot = quickEditSnapshot
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.objectValue(key: String): Map<String, Any?>? =
        this[key] as? Map<String, Any?>

    private fun Map<String, Any?>.toQuickEditSnapshot(): CaptureQuickEditSnapshot? {
        val transactionId = this["transactionId"] as? String ?: return null
        val merchant = this["merchant"] as? String ?: return null
        val amount = (this["amountInWon"] as? Number)?.toInt() ?: return null
        val accountingDate = this["accountingDate"] as? String ?: return null
        val localTime = this["localTime"] as? String ?: return null
        val categoryId = this["categoryId"] as? String ?: return null
        val memo = this["memo"] as? String ?: return null
        val aggregateVersion = (this["aggregateVersion"] as? Number)?.toInt() ?: return null
        if (
            transactionId.isBlank() ||
            merchant.isBlank() ||
            amount <= 0 ||
            accountingDate.isBlank() ||
            categoryId.isBlank() ||
            aggregateVersion < 1
        ) {
            return null
        }
        return CaptureQuickEditSnapshot(
            transactionId = transactionId,
            merchant = merchant,
            amountInWon = amount,
            accountingDate = accountingDate,
            localTime = localTime,
            categoryId = categoryId,
            memo = memo,
            aggregateVersion = aggregateVersion
        )
    }

    companion object {
        const val RAW_NOTIFICATION_FUNCTION_NAME = "submitAndroidRawNotification"
        const val LEGACY_ENVELOPE_FUNCTION_NAME = "submitCaptureEnvelope"
    }
}

class CaptureSubmissionContractException(code: String) : IllegalStateException(code)
