package com.household.account.quickedit

import com.household.account.ledger.HouseholdCommandKind
import com.household.account.paymentcapture.CaptureSessionScope

data class QuickEditUpdateFeedback(
    val commandId: String,
    val transactionId: String,
    val expectedVersion: Int,
    val patch: Map<String, Any?>,
    val state: String,
    val transaction: Map<String, Any?>? = null
)

internal data class CompletedQuickEditUpdateFeedback(
    val scope: CaptureSessionScope,
    val feedback: QuickEditUpdateFeedback,
    val completedAtEpochMillis: Long
)

internal fun QuickEditCommandOutboxEntry.updateFeedback(
    state: String,
    transaction: Any? = null
): QuickEditUpdateFeedback? {
    if (envelope.command != HouseholdCommandKind.UPDATE) return null
    val version = envelope.payload["expectedVersion"] as? Number ?: return null
    if (version.toDouble() != version.toInt().toDouble() || version.toInt() < 1) return null
    @Suppress("UNCHECKED_CAST")
    val patch = envelope.payload["patch"] as? Map<String, Any?> ?: return null
    @Suppress("UNCHECKED_CAST")
    val canonical = transaction as? Map<String, Any?>
    return QuickEditUpdateFeedback(
        envelope.commandId, transactionId, version.toInt(), patch.toMap(), state,
        canonical?.toMap()
    )
}
