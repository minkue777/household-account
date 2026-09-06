package com.household.account.service

import android.app.Notification
import androidx.core.app.NotificationCompat
import com.household.account.paymentcapture.StructuredNotificationMessage

/** AndroidX parses MessagingStyle extras on every supported API, including API 26. */
internal object NotificationMessageExtractor {
    fun extract(notification: Notification): List<StructuredNotificationMessage> = runCatching {
        NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
            ?.messages.orEmpty().map { message ->
                StructuredNotificationMessage(message.text?.toString().orEmpty(), message.timestamp)
            }
    }.getOrDefault(emptyList())
}
