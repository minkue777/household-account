package com.household.account.quickedit

import android.content.Context
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
        return runCatching { decode(plaintext) }
            .getOrElse {
                encryptedStore.clear()
                QuickEditQueueState()
            }
    }

    override fun replace(state: QuickEditQueueState) {
        encryptedStore.write(encode(state))
    }

    override fun clear() = encryptedStore.clear()

    private fun encode(state: QuickEditQueueState): String = JSONObject().apply {
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
                })
            }
        })
    }.toString()

    private fun decode(value: String): QuickEditQueueState {
        val root = JSONObject(value)
        val entries = root.getJSONArray("entries")
        return QuickEditQueueState(
            nextSequence = root.getLong("nextSequence"),
            activeTransactionId = root.optString("activeTransactionId")
                .takeIf { it.isNotBlank() && it != "null" },
            entries = buildList {
                for (index in 0 until entries.length()) {
                    val item = entries.getJSONObject(index)
                    add(
                        QuickEditQueueEntry(
                            scope = CaptureSessionScope(
                                item.getString("householdId"),
                                item.getString("memberId"),
                                item.getLong("sessionGeneration")
                            ),
                            transactionId = item.getString("transactionId"),
                            sequence = item.getLong("sequence"),
                            enqueuedAtEpochMillis = item.getLong("enqueuedAtEpochMillis")
                        )
                    )
                }
            }
        )
    }
}
