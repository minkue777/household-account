package com.household.account.data

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
        postedAtMillis: Long
    ) {
        val payload = mapOf(
            "packageName" to packageName,
            "title" to title,
            "text" to text,
            "bigText" to bigText,
            "textLines" to textLines,
            "fullText" to fullText,
            "postedAtMillis" to postedAtMillis
        )

        gateway.call(FUNCTION_NAME, payload)
    }

    companion object {
        internal const val FUNCTION_NAME = "submitNotificationDiagnostic"
    }
}
