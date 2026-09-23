package com.household.account.quickedit

import com.household.account.paymentcapture.CaptureQuickEditSnapshot
import com.household.account.paymentcapture.CaptureSessionScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QuickEditPendingQueueJsonCodecTest {
    private val scope = CaptureSessionScope("household-1", "member-1", 3L)

    @Test
    fun `Quick Edit snapshot을 암호화 Queue JSON에 왕복 보존한다`() {
        val snapshot = CaptureQuickEditSnapshot(
            transactionId = "transaction-1",
            merchant = "가맹점",
            amountInWon = 10_000,
            accountingDate = "2026-07-23",
            localTime = "20:00",
            categoryId = "etc",
            memo = "메모",
            aggregateVersion = 2,
            tags = listOf("2026부산여행", "가족 모임")
        )
        val state = QuickEditQueueState(
            nextSequence = 2L,
            entries = listOf(
                QuickEditQueueEntry(
                    scope = scope,
                    transactionId = "transaction-1",
                    sequence = 1L,
                    enqueuedAtEpochMillis = 100L,
                    snapshot = snapshot,
                    observationId = "observation.android.codec"
                )
            )
        )

        val decoded = QuickEditPendingQueueJsonCodec.decode(
            QuickEditPendingQueueJsonCodec.encode(state)
        ).entries.single()
        assertEquals(snapshot, decoded.snapshot)
        assertEquals("observation.android.codec", decoded.observationId)
    }

    @Test
    fun `태그 없는 구버전 snapshot은 빈 태그로 복원하고 손상 태그는 query로 복구한다`() {
        val snapshot = CaptureQuickEditSnapshot("transaction-1", "가맹점", 1000,
            "2026-09-23", "12:00", "etc", "", 1)
        val state = QuickEditQueueState(entries = listOf(QuickEditQueueEntry(
            scope, "transaction-1", 1L, 100L, snapshot)))
        val json = org.json.JSONObject(QuickEditPendingQueueJsonCodec.encode(state))
        val storedSnapshot = json.getJSONArray("entries").getJSONObject(0).getJSONObject("quickEditSnapshot")
        storedSnapshot.remove("tags")
        assertEquals(emptyList<String>(), QuickEditPendingQueueJsonCodec.decode(json.toString()).entries.single().snapshot?.tags)
        storedSnapshot.put("tags", org.json.JSONArray().put(123))
        val recovered = QuickEditPendingQueueJsonCodec.decode(json.toString()).entries.single()
        assertEquals("transaction-1", recovered.transactionId)
        assertNull(recovered.snapshot)
    }

    @Test
    fun `구버전 ID 전용 Queue JSON은 snapshot 없이 계속 복원한다`() {
        val legacy = """
            {
              "nextSequence": 2,
              "activeTransactionId": null,
              "entries": [{
                "householdId": "household-1",
                "memberId": "member-1",
                "sessionGeneration": 3,
                "transactionId": "transaction-1",
                "sequence": 1,
                "enqueuedAtEpochMillis": 100
              }]
            }
        """.trimIndent()

        val entry = QuickEditPendingQueueJsonCodec.decode(legacy).entries.single()

        assertEquals("transaction-1", entry.transactionId)
        assertNull(entry.snapshot)
        assertNull(entry.observationId)
    }
}
