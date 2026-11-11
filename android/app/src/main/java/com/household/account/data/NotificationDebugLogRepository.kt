package com.household.account.data

import com.household.account.paymentcapture.CaptureDeliveryFailure
import com.household.account.server.AuthenticatedCallableGateway
import com.household.account.server.FirebaseAuthenticatedCallableGateway

class NotificationDebugLogRepository(
    private val gateway: AuthenticatedCallableGateway = FirebaseAuthenticatedCallableGateway()
) {

    suspend fun saveRawLog(
        packageName: String,
        title: String,
        text: String,
        bigText: String,
        textLines: List<String>,
        fullText: String,
        postedAtMillis: Long,
        captureFailure: CaptureDeliveryFailure? = null
    ) {
        val payload = mapOf(
            "packageName" to packageName,
            "title" to title,
            "text" to text,
            "bigText" to bigText,
            "textLines" to textLines,
            "fullText" to fullText,
            "postedAtMillis" to postedAtMillis
        ) + (captureFailure?.let { mapOf("captureFailure" to it.toMap()) } ?: emptyMap())

        gateway.call(FUNCTION_NAME, payload)
    }

    companion object {
        internal const val FUNCTION_NAME = "submitNotificationDiagnostic"
    }
}
