package com.household.account.paymentcapture

import android.content.Context
import com.household.account.security.AndroidKeystoreEncryptedStore
import org.json.JSONArray
import org.json.JSONObject

/** Queue 전체를 AndroidKeystore AES-256-GCM으로 암호화해 plaintext metadata를 남기지 않습니다. */
class AndroidKeystoreCaptureQueueStore(context: Context) : CaptureQueueStore {
    private val encryptedStore = AndroidKeystoreEncryptedStore(
        context = context,
        PREFERENCES_NAME,
        KEY_ALIAS
    )

    override fun load(): List<QueuedCapture> {
        val plaintext = encryptedStore.read() ?: return emptyList()
        return runCatching { decodeEntries(plaintext) }
            .getOrElse {
                encryptedStore.clear()
                emptyList()
            }
    }

    override fun replace(entries: List<QueuedCapture>) {
        if (entries.isEmpty()) {
            clear()
            return
        }
        val plaintext = encodeEntries(entries)
        encryptedStore.write(plaintext)
    }

    override fun clear() {
        encryptedStore.clear()
    }

    private fun encodeEntries(entries: List<QueuedCapture>): String = JSONArray().apply {
        entries.forEach { entry ->
            put(JSONObject().apply {
                put("householdId", entry.scope.householdId)
                put("memberId", entry.scope.memberId)
                put("sessionGeneration", entry.scope.sessionGeneration)
                put("queuedAtEpochMillis", entry.queuedAtEpochMillis)
                put("envelope", JSONObject(entry.envelope.toJson()))
                put("terminalBranches", JSONArray(entry.terminalBranches.map { it.name }))
            })
        }
    }.toString()

    private fun decodeEntries(value: String): List<QueuedCapture> {
        val array = JSONArray(value)
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                val branches = item.getJSONArray("terminalBranches")
                add(
                    QueuedCapture(
                        scope = CaptureSessionScope(
                            householdId = item.getString("householdId"),
                            memberId = item.getString("memberId"),
                            sessionGeneration = item.getLong("sessionGeneration")
                        ),
                        envelope = CaptureEnvelopeV1.fromJson(item.getJSONObject("envelope").toString()),
                        queuedAtEpochMillis = item.getLong("queuedAtEpochMillis"),
                        terminalBranches = buildSet {
                            for (branchIndex in 0 until branches.length()) {
                                add(CaptureBranch.valueOf(branches.getString(branchIndex)))
                            }
                        }
                    )
                )
            }
        }
    }

    companion object {
        private const val PREFERENCES_NAME = "capture_delivery_queue.v1"
        private const val KEY_ALIAS = "household.capture.queue.aes256gcm.v1"
    }
}
