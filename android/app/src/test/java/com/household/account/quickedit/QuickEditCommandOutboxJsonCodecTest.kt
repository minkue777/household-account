package com.household.account.quickedit

import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.paymentcapture.CaptureSessionScope
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class QuickEditCommandOutboxJsonCodecTest {
    @Test
    fun `프로세스 재시작용 snapshot은 envelope와 terminal 상태를 손실 없이 왕복한다`() {
        val scope = CaptureSessionScope("household-1", "member-1", 7L)
        val pending = entry(
            scope = scope,
            operationId = "pending",
            queuedAt = 100L
        )
        val needsAttention = entry(
            scope = scope,
            operationId = "terminal",
            queuedAt = 200L
        ).copy(
            deliveryState = QuickEditCommandDeliveryState.NEEDS_ATTENTION,
            terminalCode = "VERSION_MISMATCH",
            terminalAtEpochMillis = 300L,
            failureNotificationPending = true
        )

        val encoded = QuickEditCommandOutboxJsonCodec.encode(
            listOf(pending, needsAttention)
        )

        assertEquals("quick-edit-command-outbox.v1", JSONObject(encoded).getString(
            "contractVersion"
        ))
        assertEquals(
            listOf(pending, needsAttention),
            QuickEditCommandOutboxJsonCodec.decode(encoded)
        )
    }

    @Test
    fun `알 수 없는 snapshot contract는 빈 Queue로 오인하지 않고 손상으로 거부한다`() {
        val encoded = QuickEditCommandOutboxJsonCodec.encode(
            listOf(entry(CaptureSessionScope("h", "m", 1L), "version", 1L))
        )
        val root = JSONObject(encoded).put("contractVersion", "quick-edit-command-outbox.v2")

        assertThrows(IllegalArgumentException::class.java) {
            QuickEditCommandOutboxJsonCodec.decode(root.toString())
        }
    }

    @Test
    fun `알 수 없는 command와 delivery state는 손상으로 거부한다`() {
        val encoded = QuickEditCommandOutboxJsonCodec.encode(
            listOf(entry(CaptureSessionScope("h", "m", 1L), "schema", 1L))
        )
        val unknownCommand = JSONObject(encoded)
        unknownCommand.getJSONArray("entries").getJSONObject(0)
            .getJSONObject("envelope")
            .put("command", "ledger.unknown.v1")
        assertThrows(IllegalStateException::class.java) {
            QuickEditCommandOutboxJsonCodec.decode(unknownCommand.toString())
        }

        val unknownState = JSONObject(encoded)
        unknownState.getJSONArray("entries").getJSONObject(0)
            .put("deliveryState", "UNKNOWN")
        assertThrows(IllegalArgumentException::class.java) {
            QuickEditCommandOutboxJsonCodec.decode(unknownState.toString())
        }
    }

    @Test
    fun `scope와 payload 또는 terminal 상태가 모순된 snapshot은 손상으로 거부한다`() {
        val encoded = QuickEditCommandOutboxJsonCodec.encode(
            listOf(entry(CaptureSessionScope("h", "m", 1L), "semantic", 1L))
        )
        val mismatchedTransaction = JSONObject(encoded)
        mismatchedTransaction.getJSONArray("entries").getJSONObject(0)
            .put("transactionId", "different")
        assertThrows(IllegalArgumentException::class.java) {
            QuickEditCommandOutboxJsonCodec.decode(mismatchedTransaction.toString())
        }

        val invalidTerminal = JSONObject(encoded)
        invalidTerminal.getJSONArray("entries").getJSONObject(0)
            .put("deliveryState", "NEEDS_ATTENTION")
            .put("failureNotificationPending", false)
        assertThrows(IllegalArgumentException::class.java) {
            QuickEditCommandOutboxJsonCodec.decode(invalidTerminal.toString())
        }
    }

    private fun entry(
        scope: CaptureSessionScope,
        operationId: String,
        queuedAt: Long
    ) = QuickEditCommandOutboxEntry(
        scope = scope,
        transactionId = "transaction-$operationId",
        envelope = HouseholdCommandEnvelopeV1.create(
            householdId = scope.householdId,
            command = HouseholdCommandKind.UPDATE,
            payload = mapOf(
                "transactionId" to "transaction-$operationId",
                "expectedVersion" to 3,
                "patch" to mapOf(
                    "memo" to "수정 메모",
                    "optional" to null,
                    "tags" to listOf("a", "b")
                )
            ),
            operationId = operationId
        ),
        queuedAtEpochMillis = queuedAt
    )
}
