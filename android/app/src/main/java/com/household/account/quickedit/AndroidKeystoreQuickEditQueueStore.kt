package com.household.account.quickedit

import android.content.Context
import com.household.account.paymentcapture.CaptureQuickEditSnapshot
import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.security.AndroidKeystoreEncryptedStore
import org.json.JSONArray
import org.json.JSONObject

class AndroidKeystoreQuickEditQueueStore(context: Context) : QuickEditQueueStore {
    private val encryptedStore = AndroidKeystoreEncryptedStore(
        context,
        "quick_edit_pending_queue.v1",
        "household.quickedit.queue.aes256gcm.v1"
    )

    override fun load(): QuickEditQueueState {
        val plaintext = encryptedStore.read() ?: return QuickEditQueueState()
        return runCatching { QuickEditPendingQueueJsonCodec.decode(plaintext) }
            .getOrElse {
                encryptedStore.clear()
                QuickEditQueueState()
            }
    }

    override fun replace(state: QuickEditQueueState) {
        encryptedStore.write(QuickEditPendingQueueJsonCodec.encode(state))
    }

    override fun clear() = encryptedStore.clear()
}

internal object QuickEditPendingQueueJsonCodec {
    fun encode(state: QuickEditQueueState): String = JSONObject().apply {
        put("nextSequence", state.nextSequence)
        put("activeTransactionId", state.activeTransactionId ?: JSONObject.NULL)
        put("entries", JSONArray().apply {
            state.entries.forEach { entry ->
                put(JSONObject().apply {
                    put("householdId", entry.scope.householdId)
                    put("memberId", entry.scope.memberId)
                    put("sessionGeneration", entry.scope.sessionGeneration)
                    put("transactionId", entry.transactionId)
                    put("sequence", entry.sequence)
                    put("enqueuedAtEpochMillis", entry.enqueuedAtEpochMillis)
                    entry.observationId?.let { put("observationId", it) }
                    entry.snapshot?.let { snapshot ->
                        put("quickEditSnapshot", JSONObject().apply {
                            put("transactionId", snapshot.transactionId)
                            put("merchant", snapshot.merchant)
                            put("amountInWon", snapshot.amountInWon)
                            put("accountingDate", snapshot.accountingDate)
                            put("localTime", snapshot.localTime)
                            put("categoryId", snapshot.categoryId)
                            put("memo", snapshot.memo)
                            put("aggregateVersion", snapshot.aggregateVersion)
                        })
                    }
                })
            }
        })
    }.toString()

    fun decode(value: String): QuickEditQueueState {
        val root = JSONObject(value)
        val entries = root.getJSONArray("entries")
        return QuickEditQueueState(
            nextSequence = root.getLong("nextSequence"),
            activeTransactionId = root.optString("activeTransactionId")
                .takeIf { it.isNotBlank() && it != "null" },
            entries = buildList {
                for (index in 0 until entries.length()) {
                    val item = entries.getJSONObject(index)
                    val transactionId = item.getString("transactionId")
                    add(
                        QuickEditQueueEntry(
                            scope = CaptureSessionScope(
                                item.getString("householdId"),
                                item.getString("memberId"),
                                item.getLong("sessionGeneration")
                            ),
                            transactionId = transactionId,
                            sequence = item.getLong("sequence"),
                            enqueuedAtEpochMillis = item.getLong("enqueuedAtEpochMillis"),
                            observationId = item.optString("observationId")
                                .takeIf { it.isNotBlank() && it != "null" },
                            snapshot = item.optJSONObject("quickEditSnapshot")
                                ?.toQuickEditSnapshot()
                                ?.takeIf { it.transactionId == transactionId }
                        )
                    )
                }
            }
        )
    }

    private fun JSONObject.toQuickEditSnapshot(): CaptureQuickEditSnapshot? = runCatching {
        CaptureQuickEditSnapshot(
            transactionId = getString("transactionId"),
            merchant = getString("merchant"),
            amountInWon = getInt("amountInWon"),
            accountingDate = getString("accountingDate"),
            localTime = getString("localTime"),
            categoryId = getString("categoryId"),
            memo = getString("memo"),
            aggregateVersion = getInt("aggregateVersion")
        )
    }.getOrNull()?.takeIf {
        it.transactionId.isNotBlank() &&
            it.merchant.isNotBlank() &&
            it.amountInWon > 0 &&
            it.accountingDate.isNotBlank() &&
            it.categoryId.isNotBlank() &&
            it.aggregateVersion > 0
    }
}
