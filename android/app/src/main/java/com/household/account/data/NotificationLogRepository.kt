package com.household.account.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.household.account.parser.ParseResult
import kotlinx.coroutines.tasks.await

class NotificationLogRepository {
    private val db = FirebaseFirestore.getInstance()
    private val logsCollection = db.collection("notification_logs")

    suspend fun saveNotificationLog(
        householdId: String,
        packageName: String,
        source: String,
        title: String,
        text: String,
        bigText: String,
        fullText: String,
        postedAtMillis: Long,
        parseResult: ParseResult
    ) {
        val data = mutableMapOf<String, Any>(
            "householdId" to householdId,
            "packageName" to packageName,
            "source" to source,
            "title" to title,
            "text" to text,
            "bigText" to bigText,
            "fullText" to fullText,
            "postedAtMillis" to postedAtMillis,
            "capturedAt" to Timestamp.now(),
            "parseSuccess" to parseResult.success
        )

        parseResult.errorMessage?.takeIf { it.isNotBlank() }?.let {
            data["parseErrorMessage"] = it
        }

        parseResult.expense?.let { expense ->
            data["parsedExpense"] = mapOf(
                "date" to expense.date,
                "time" to expense.time,
                "merchant" to expense.merchant,
                "amount" to expense.amount,
                "category" to expense.category,
                "cardType" to expense.cardType,
                "cardLastFour" to expense.cardLastFour
            )
            data["eventType"] = parseResult.eventType.name
        }

        logsCollection.add(data).await()
    }
}
