package com.household.account.data

import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * 원본 알림을 저장하는 Repository (분석용)
 */
class RawNotificationRepository {

    private val firestore = FirebaseFirestore.getInstance()
    private val collection = firestore.collection("rawNotifications")

    /**
     * 원본 알림 저장
     */
    suspend fun saveNotification(
        packageName: String,
        title: String,
        text: String,
        bigText: String,
        fullText: String
    ): String {
        val now = LocalDateTime.now()
        val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
        val timeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")

        val data = hashMapOf(
            "packageName" to packageName,
            "title" to title,
            "text" to text,
            "bigText" to bigText,
            "fullText" to fullText,
            "date" to now.format(dateFormatter),
            "time" to now.format(timeFormatter),
            "createdAt" to now.toString()
        )

        val docRef = collection.add(data).await()
        return docRef.id
    }
}
