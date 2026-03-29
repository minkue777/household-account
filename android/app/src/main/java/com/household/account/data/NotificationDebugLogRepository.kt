package com.household.account.data

import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await

class NotificationDebugLogRepository {

    private val firestore = FirebaseFirestore.getInstance()
    private val debugLogsCollection = firestore.collection("notification_debug_logs")

    suspend fun saveRawLog(
        householdId: String,
        memberName: String,
        packageName: String,
        source: String,
        title: String,
        text: String,
        bigText: String,
        textLines: List<String>,
        fullText: String,
        postedAtMillis: Long
    ) {
        val payload = hashMapOf(
            "householdId" to householdId,
            "memberName" to memberName,
            "packageName" to packageName,
            "source" to source,
            "title" to title,
            "text" to text,
            "bigText" to bigText,
            "textLines" to textLines,
            "fullText" to fullText,
            "postedAtMillis" to postedAtMillis,
            "createdAt" to FieldValue.serverTimestamp()
        )

        debugLogsCollection.add(payload).await()
    }
}
