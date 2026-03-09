package com.household.account.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.household.account.MainActivity
import com.household.account.R
import com.household.account.util.FcmTokenManager

/**
 * Firebase Cloud Messaging 서비스
 * - 토큰 갱신 시 Firestore에 저장
 * - 포그라운드에서 알림 수신 시 시스템 알림 표시
 */
class FcmService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FcmService"
        private const val CHANNEL_ID = "expense_notifications"
        private const val CHANNEL_NAME = "지출 알림"
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "New FCM token: $token")
        FcmTokenManager.saveTokenToFirestore(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        Log.d(TAG, "Message received from: ${message.from}")

        // notification 페이로드가 있으면 포그라운드에서 알림 표시
        // (백그라운드에서는 시스템이 notification 기반으로 자동 표시)
        message.notification?.let { notification ->
            showNotification(notification.title, notification.body)
        }
    }

    private fun showNotification(title: String?, body: String?) {
        // 알림 채널 생성
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        )
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)

        // 알림 클릭 시 MainActivity 열기
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        manager.notify(System.currentTimeMillis().toInt(), notification)
    }
}
