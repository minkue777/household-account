package com.household.account.ledger

import com.household.account.server.AuthenticatedCallableGateway
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HouseholdCommandClientTest {
    @Test
    fun `command envelope는 actor를 싣지 않고 인증 transport와 household scope만 사용한다`() = runTest {
        var functionName = ""
        var sent = emptyMap<String, Any?>()
        val recordingGateway = object : AuthenticatedCallableGateway {
            override suspend fun call(name: String, payload: Map<String, Any?>): Map<String, Any?> {
                functionName = name
                sent = payload
                return mapOf(
                    "contractVersion" to "household-command-response.v1",
                    "commandId" to payload["commandId"],
                    "result" to mapOf("kind" to "succeeded", "value" to emptyMap<String, Any?>())
                )
            }
        }
        val client = CallableHouseholdCommandClient(recordingGateway)
        val envelope = HouseholdCommandEnvelopeV1.create(
            householdId = "household-1",
            command = HouseholdCommandKind.UPDATE,
            payload = mapOf("transactionId" to "transaction-1", "expectedVersion" to 2),
            operationId = "operation-1"
        )

        assertTrue(client.execute(envelope) is HouseholdCommandResult.Succeeded)
        assertEquals("executeHouseholdCommand", functionName)
        assertEquals("household-command.v1", sent["contractVersion"])
        assertEquals("household-1", sent["householdId"])
        assertEquals("ledger.update-transaction.v1", sent["command"])
        assertFalse(sent.containsKey("uid"))
        assertFalse(sent.containsKey("memberId"))
        assertFalse(sent.containsKey("role"))
    }

    @Test
    fun `Android가 노출하는 모든 command 이름은 공통 manifest의 Android 허용 이름이다`() {
        assertEquals(
            setOf(
                "access.resolve-signed-in-user.v1",
                "ledger.update-transaction.v1",
                "ledger.delete-transaction.v1",
                "ledger.split-transaction.v1",
                "ledger.request-notification.v1",
                "notifications.register-endpoint.v1",
                "notifications.remove-endpoint.v1"
            ),
            HouseholdCommandKind.entries.map { it.wireName }.toSet()
        )
    }

    @Test
    fun `version conflict는 성공으로 축약하지 않는다`() = runTest {
        val client = CallableHouseholdCommandClient(object : AuthenticatedCallableGateway {
            override suspend fun call(
                functionName: String,
                payload: Map<String, Any?>
            ): Map<String, Any?> = mapOf(
                "contractVersion" to "household-command-response.v1",
                "commandId" to payload["commandId"],
                "result" to mapOf(
                    "kind" to "rejected",
                    "error" to mapOf("code" to "VERSION_MISMATCH", "retryable" to false)
                )
            )
        })
        val result = client.execute(
            HouseholdCommandEnvelopeV1.create(
                "household-1",
                HouseholdCommandKind.DELETE,
                mapOf("transactionId" to "transaction-1", "expectedVersion" to 3),
                "operation-2"
            )
        )

        assertTrue(result is HouseholdCommandResult.Conflict)
        assertEquals(null, (result as HouseholdCommandResult.Conflict).currentVersion)
    }

    @Test
    fun `계약 버전과 command id가 다른 응답은 성공으로 처리하지 않는다`() = runTest {
        suspend fun execute(response: (Map<String, Any?>) -> Map<String, Any?>): HouseholdCommandResult {
            val client = CallableHouseholdCommandClient(object : AuthenticatedCallableGateway {
                override suspend fun call(
                    functionName: String,
                    payload: Map<String, Any?>
                ): Map<String, Any?> = response(payload)
            })
            return client.execute(
                HouseholdCommandEnvelopeV1.create(
                    "household-1",
                    HouseholdCommandKind.DELETE,
                    mapOf("transactionId" to "transaction-1", "expectedVersion" to 1),
                    "operation-3"
                )
            )
        }

        assertEquals(
            HouseholdCommandResult.ContractFailure("INVALID_RESPONSE_VERSION"),
            execute { payload ->
                mapOf(
                    "contractVersion" to "household-command-response.v2",
                    "commandId" to payload["commandId"],
                    "result" to mapOf("kind" to "succeeded", "value" to null)
                )
            }
        )
        assertEquals(
            HouseholdCommandResult.ContractFailure("COMMAND_ID_MISMATCH"),
            execute {
                mapOf(
                    "contractVersion" to "household-command-response.v1",
                    "commandId" to "another-command",
                    "result" to mapOf("kind" to "succeeded", "value" to null)
                )
            }
        )
    }
}
