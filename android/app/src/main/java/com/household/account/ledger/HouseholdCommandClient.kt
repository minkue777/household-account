package com.household.account.ledger

import com.household.account.server.AuthenticatedCallableGateway
import java.util.UUID

enum class HouseholdCommandKind(val wireName: String) {
    RESOLVE_SIGNED_IN_USER("access.resolve-signed-in-user.v1"),
    UPDATE("ledger.update-transaction.v1"),
    DELETE("ledger.delete-transaction.v1"),
    SPLIT("ledger.split-transaction.v1"),
    REQUEST_HOUSEHOLD_NOTIFICATION("ledger.request-notification.v1"),
    REGISTER_NOTIFICATION_ENDPOINT("notifications.register-endpoint.v1"),
    REMOVE_NOTIFICATION_ENDPOINT("notifications.remove-endpoint.v1")
}

data class HouseholdCommandEnvelopeV1(
    val commandId: String,
    val idempotencyKey: String,
    val householdId: String?,
    val command: HouseholdCommandKind,
    val payload: Map<String, Any?>
) {
    init {
        require(commandId.isNotBlank())
        require(idempotencyKey.isNotBlank())
        require(householdId == null || householdId.isNotBlank())
    }

    fun toMap(): Map<String, Any?> = buildMap {
        put("contractVersion", CONTRACT_VERSION)
        put("commandId", commandId)
        put("idempotencyKey", idempotencyKey)
        householdId?.let { put("householdId", it) }
        put("command", command.wireName)
        put("payload", payload)
    }

    companion object {
        const val CONTRACT_VERSION = "household-command.v1"

        fun create(
            householdId: String,
            command: HouseholdCommandKind,
            payload: Map<String, Any?>,
            operationId: String = UUID.randomUUID().toString()
        ) = HouseholdCommandEnvelopeV1(
            commandId = "android:$operationId",
            idempotencyKey = "android-quick-edit:$operationId",
            householdId = householdId,
            command = command,
            payload = payload
        )

        fun createPrincipal(
            command: HouseholdCommandKind,
            payload: Map<String, Any?> = emptyMap(),
            operationId: String = UUID.randomUUID().toString()
        ) = HouseholdCommandEnvelopeV1(
            commandId = "android:$operationId",
            idempotencyKey = "android-principal:$operationId",
            householdId = null,
            command = command,
            payload = payload
        )
    }
}

sealed interface HouseholdCommandResult {
    data class Succeeded(val value: Any?) : HouseholdCommandResult
    data class Conflict(val currentVersion: Int?) : HouseholdCommandResult
    data class Rejected(val code: String) : HouseholdCommandResult
    data class RetryableFailure(val code: String) : HouseholdCommandResult
    data class ContractFailure(val code: String) : HouseholdCommandResult
}

interface HouseholdCommandClient {
    suspend fun execute(envelope: HouseholdCommandEnvelopeV1): HouseholdCommandResult
}

class CallableHouseholdCommandClient(
    private val gateway: AuthenticatedCallableGateway
) : HouseholdCommandClient {
    override suspend fun execute(envelope: HouseholdCommandEnvelopeV1): HouseholdCommandResult {
        val response = try {
            gateway.call(FUNCTION_NAME, envelope.toMap())
        } catch (_: Exception) {
            return HouseholdCommandResult.RetryableFailure("SERVER_UNAVAILABLE")
        }

        if (response["contractVersion"] != RESPONSE_CONTRACT_VERSION) {
            return HouseholdCommandResult.ContractFailure("INVALID_RESPONSE_VERSION")
        }
        if (response["commandId"] != envelope.commandId) {
            return HouseholdCommandResult.ContractFailure("COMMAND_ID_MISMATCH")
        }

        val result = response.objectValue("result")
            ?: return HouseholdCommandResult.ContractFailure("COMMAND_RESULT_MISSING")
        return when (result["kind"]?.toString()) {
            "succeeded", "already-processed" -> HouseholdCommandResult.Succeeded(result["value"])
            "rejected" -> decodeRejection(result)
            else -> HouseholdCommandResult.ContractFailure("INVALID_COMMAND_RESPONSE")
        }
    }

    private fun decodeRejection(result: Map<String, Any?>): HouseholdCommandResult {
        val error = result.objectValue("error")
            ?: return HouseholdCommandResult.ContractFailure("COMMAND_ERROR_MISSING")
        val code = error["code"]?.toString().orEmpty()
        val retryable = error["retryable"] as? Boolean
            ?: return HouseholdCommandResult.ContractFailure("COMMAND_ERROR_INVALID")
        if (code.isBlank()) {
            return HouseholdCommandResult.ContractFailure("COMMAND_ERROR_INVALID")
        }
        if (retryable) return HouseholdCommandResult.RetryableFailure(code)
        if (code.endsWith("VERSION_MISMATCH")) {
            return HouseholdCommandResult.Conflict(currentVersion = null)
        }
        return HouseholdCommandResult.Rejected(code)
    }

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.objectValue(key: String): Map<String, Any?>? =
        this[key] as? Map<String, Any?>

    companion object {
        const val FUNCTION_NAME = "executeHouseholdCommand"
        const val RESPONSE_CONTRACT_VERSION = "household-command-response.v1"
    }
}
