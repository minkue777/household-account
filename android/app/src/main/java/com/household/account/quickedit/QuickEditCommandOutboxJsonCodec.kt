package com.household.account.quickedit

import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.paymentcapture.CaptureSessionScope
import org.json.JSONArray
import org.json.JSONObject

internal object QuickEditCommandOutboxJsonCodec {
    private const val CONTRACT_VERSION = "quick-edit-command-outbox.v1"

    fun encode(entries: List<QuickEditCommandOutboxEntry>): String =
        JSONObject().apply {
            put("contractVersion", CONTRACT_VERSION)
            put("entries", JSONArray().apply {
                entries.forEach { entry -> put(encodeEntry(entry)) }
            })
        }.toString()

    fun decode(value: String): List<QuickEditCommandOutboxEntry> {
        val root = JSONObject(value)
        require(root.getString("contractVersion") == CONTRACT_VERSION) {
            "Unsupported QuickEdit outbox contract"
        }
        val array = root.getJSONArray("entries")
        return buildList {
            for (index in 0 until array.length()) {
                add(decodeEntry(array.getJSONObject(index)))
            }
        }
    }

    private fun encodeEntry(entry: QuickEditCommandOutboxEntry) = JSONObject().apply {
        put("householdId", entry.scope.householdId)
        put("memberId", entry.scope.memberId)
        put("sessionGeneration", entry.scope.sessionGeneration)
        put("transactionId", entry.transactionId)
        put("queuedAtEpochMillis", entry.queuedAtEpochMillis)
        put("deliveryState", entry.deliveryState.name)
        put("terminalCode", entry.terminalCode ?: JSONObject.NULL)
        put("terminalAtEpochMillis", entry.terminalAtEpochMillis ?: JSONObject.NULL)
        put("failureNotificationPending", entry.failureNotificationPending)
        put("envelope", JSONObject().apply {
            put("commandId", entry.envelope.commandId)
            put("idempotencyKey", entry.envelope.idempotencyKey)
            put("householdId", entry.envelope.householdId ?: JSONObject.NULL)
            put("command", entry.envelope.command.wireName)
            put("payload", jsonValue(entry.envelope.payload))
        })
    }

    private fun decodeEntry(item: JSONObject): QuickEditCommandOutboxEntry {
        val envelope = item.getJSONObject("envelope")
        val commandWireName = envelope.getString("command")
        val command = HouseholdCommandKind.entries.singleOrNull {
            it.wireName == commandWireName
        } ?: error("Unsupported QuickEdit command")

        val entry = QuickEditCommandOutboxEntry(
            scope = CaptureSessionScope(
                householdId = item.getString("householdId"),
                memberId = item.getString("memberId"),
                sessionGeneration = item.getLong("sessionGeneration")
            ),
            transactionId = item.getString("transactionId"),
            envelope = HouseholdCommandEnvelopeV1(
                commandId = envelope.getString("commandId"),
                idempotencyKey = envelope.getString("idempotencyKey"),
                householdId = envelope.optNullableString("householdId"),
                command = command,
                payload = jsonObjectToMap(envelope.getJSONObject("payload"))
            ),
            queuedAtEpochMillis = item.getLong("queuedAtEpochMillis"),
            deliveryState = QuickEditCommandDeliveryState.valueOf(
                item.getString("deliveryState")
            ),
            terminalCode = item.optNullableString("terminalCode"),
            terminalAtEpochMillis = item.optNullableLong("terminalAtEpochMillis"),
            failureNotificationPending = item.optBoolean(
                "failureNotificationPending",
                false
            )
        )
        require(entry.scope.isUsable) { "Invalid QuickEdit session scope" }
        require(entry.transactionId.isNotBlank()) { "Invalid QuickEdit transaction" }
        require(entry.queuedAtEpochMillis >= 0L) { "Invalid QuickEdit queued time" }
        require(entry.envelope.householdId == entry.scope.householdId) {
            "QuickEdit household scope mismatch"
        }
        require(entry.envelope.payload["transactionId"] == entry.transactionId) {
            "QuickEdit transaction scope mismatch"
        }
        require(entry.envelope.command in QUICK_EDIT_DELIVERABLE_LEDGER_COMMANDS) {
            "Unsupported QuickEdit command"
        }
        when (entry.deliveryState) {
            QuickEditCommandDeliveryState.PENDING -> require(
                entry.terminalCode == null &&
                    entry.terminalAtEpochMillis == null &&
                    !entry.failureNotificationPending
            ) { "Invalid pending QuickEdit state" }
            QuickEditCommandDeliveryState.NEEDS_ATTENTION -> require(
                !entry.terminalCode.isNullOrBlank() &&
                    entry.terminalAtEpochMillis != null &&
                    entry.failureNotificationPending
            ) { "Invalid terminal QuickEdit state" }
        }
        return entry
    }

    private fun jsonValue(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        is Map<*, *> -> JSONObject().apply {
            value.forEach { (key, nested) -> put(key.toString(), jsonValue(nested)) }
        }
        is Iterable<*> -> JSONArray().apply { value.forEach { put(jsonValue(it)) } }
        is Array<*> -> JSONArray().apply { value.forEach { put(jsonValue(it)) } }
        else -> value
    }

    private fun jsonObjectToMap(value: JSONObject): Map<String, Any?> = buildMap {
        value.keys().forEach { key -> put(key, kotlinValue(value.get(key))) }
    }

    private fun kotlinValue(value: Any): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> jsonObjectToMap(value)
        is JSONArray -> buildList {
            for (index in 0 until value.length()) add(kotlinValue(value.get(index)))
        }
        else -> value
    }

    private fun JSONObject.optNullableString(key: String): String? =
        if (isNull(key)) null else getString(key)

    private fun JSONObject.optNullableLong(key: String): Long? =
        if (isNull(key)) null else getLong(key)

}
