package com.household.account.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.household.account.data.NotificationDebugLogRepository
import com.household.account.paymentcapture.AndroidCaptureDelivery
import com.household.account.paymentcapture.AndroidCaptureLatencyTelemetry
import com.household.account.paymentcapture.CaptureLatencyStage
import com.household.account.paymentcapture.PaymentSourceRegistry
import com.household.account.paymentcapture.RawNotificationEnvelopeV1
import com.household.account.paymentcapture.RawNotificationForwardingPolicy
import com.household.account.paymentcapture.RegisteredNotificationSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class CardNotificationListenerService : NotificationListenerService() {

    companion object {
        private val debugOnlyNotificationPackages = mapOf(
            "com.shcard.smartpay" to "SHINHAN_CARD",
            "kr.co.samsungcard.mpocket" to "SAMSUNG_CARD",
            "com.hyundaicard.appcard" to "HYUNDAI_CARD",
            "com.lcacApp" to "LOTTE_CARD",
            "com.hanaskcard.paycla" to "HANA_CARD",
            "com.wooricard.smartapp" to "WOORI_CARD",
            "com.ibk.cdp" to "IBK_CARD",
            "kr.co.citibank.citimobile" to "CITI_CARD",
            "com.epost.psf.sdsi" to "EPOST_BANKING",
            "com.epost.psf.ss" to "EPOST_PAY",
            "com.kakaobank.channel" to "KAKAO_BANK",
            "com.kbankwith.smartbank" to "K_BANK",
            "com.scbank.ma30" to "SC_BANK",
            "co.kr.kdb.android.smartkdb" to "KDB_BANK",
            "kr.co.dgb.dgbm" to "IM_BANK",
            "kr.co.busanbank.mbp" to "BUSAN_BANK",
            "com.knb.psb" to "KYONGNAM_BANK",
            "com.kjbank.asb.pbanking" to "GWANGJU_BANK",
            "kr.co.jbbank.privatebank" to "JEONBUK_BANK",
            "com.jejubank.smartnew" to "JEJU_BANK",
            "com.suhyup.pesmb" to "SUHYUP_BANK",
            "com.suhyup.psmb" to "SUHYUP_PARTNER_BANK",
            "kr.co.cu.onbank" to "CU_BANK",
            "com.smg.spbs" to "MG_BANK"
        )

        private val tossWalkingTitlePattern = Regex("""^\d[\d,]*\s*걸음$""")

        const val ACTION_NOTIFICATION_RECEIVED = "com.household.account.NOTIFICATION_RECEIVED"
        const val EXTRA_EXPENSE_JSON = "expense_json"
        private const val DIAGNOSTIC_DELIVERY_DELAY_MILLIS = 5_000L
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val notificationDebugLogRepository = NotificationDebugLogRepository()

    private val recentNotifications = mutableMapOf<String, Long>()
    private val duplicateWindowMs = 30_000L

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        val receivedAtElapsedRealtime = AndroidCaptureLatencyTelemetry.elapsedRealtimeMillis()

        try {
            val packageName = sbn.packageName
            val extras = sbn.notification.extras

            val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
            val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
            val textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
                ?.map { it?.toString().orEmpty().trim() }
                ?.filter { it.isNotEmpty() }
                ?: emptyList()

            val bodyText = when {
                textLines.isNotEmpty() -> textLines.joinToString("\n")
                bigText.isNotBlank() -> bigText
                text.isNotBlank() -> text
                else -> ""
            }

            val fullText = buildString {
                if (title.isNotBlank()) {
                    append(title)
                    append("\n")
                }
                if (bodyText.isNotBlank()) {
                    append(bodyText)
                }
            }.trim()

            if (fullText.isEmpty()) {
                return
            }

            val source = detectSource(packageName)
            if (source == null) {
                saveRawNotificationLogIfNeeded(
                    packageName = packageName,
                    title = title,
                    text = text,
                    bigText = bigText,
                    textLines = textLines,
                    fullText = fullText,
                    postedAtMillis = sbn.postTime
                )
                return
            }
            if (!RawNotificationForwardingPolicy.shouldForward(source, title, fullText)) return

            val notificationKey = "${packageName}_${fullText.hashCode()}"
            val now = System.currentTimeMillis()
            if (rememberRecentKey(recentNotifications, notificationKey, now, duplicateWindowMs)) {
                return
            }

            val envelope = RawNotificationEnvelopeV1.create(
                packageName = packageName,
                postedAtMillis = sbn.postTime,
                title = title,
                text = text,
                bigText = bigText,
                textLines = textLines
            )
            AndroidCaptureLatencyTelemetry.mark(
                observationId = envelope.observationId,
                stage = CaptureLatencyStage.NOTIFICATION_RECEIVED,
                atElapsedRealtimeMillis = receivedAtElapsedRealtime
            )

            serviceScope.launch {
                runCatching {
                    AndroidCaptureDelivery.enqueueAndFlush(applicationContext, envelope)
                }
                // 임시 parser 진단은 QuickEdit 표시가 끝난 뒤 보내 네트워크와
                // App Check token을 결제 저장의 빠른 경로와 경쟁시키지 않습니다.
                saveRawNotificationLogIfNeeded(
                    packageName = packageName,
                    title = title,
                    text = text,
                    bigText = bigText,
                    textLines = textLines,
                    fullText = fullText,
                    postedAtMillis = sbn.postTime
                )
            }
        } catch (_: Exception) {
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
    }

    private fun detectSource(packageName: String): RegisteredNotificationSource? =
        PaymentSourceRegistry.resolve(packageName)

    private fun saveRawNotificationLogIfNeeded(
        packageName: String,
        title: String,
        text: String,
        bigText: String,
        textLines: List<String>,
        fullText: String,
        postedAtMillis: Long
    ) {
        val source = resolveDebugLogSource(packageName, fullText) ?: return
        val normalizedTitle = title.trim()

        if (
            source == RegisteredNotificationSource.TOSS_BANK.name &&
            normalizedTitle.isNotEmpty() &&
            tossWalkingTitlePattern.matches(normalizedTitle)
        ) {
            return
        }

        serviceScope.launch {
            try {
                // 임시 진단 전송이 결제 저장과 App Check token·네트워크 연결을
                // 경쟁하지 않도록 정상 결제 경로가 끝난 뒤에 best-effort로 보냅니다.
                delay(DIAGNOSTIC_DELIVERY_DELAY_MILLIS)
                notificationDebugLogRepository.saveRawLog(
                    packageName = packageName,
                    title = title,
                    text = text,
                    bigText = bigText,
                    textLines = textLines,
                    fullText = fullText,
                    postedAtMillis = postedAtMillis
                )
            } catch (_: Exception) {
            }
        }
    }

    private fun resolveDebugLogSource(packageName: String, fullText: String): String? {
        val source = detectSource(packageName)
        if (
            source != null &&
            !RawNotificationForwardingPolicy.shouldForward(source, "", fullText)
        ) return null
        return source?.name
            ?: debugOnlyNotificationPackages[packageName]
    }

    private fun rememberRecentKey(
        recentMap: MutableMap<String, Long>,
        key: String,
        now: Long,
        windowMs: Long
    ): Boolean {
        synchronized(recentMap) {
            recentMap.entries.removeIf { now - it.value > windowMs }
            if (recentMap.containsKey(key)) {
                return true
            }
            recentMap[key] = now
        }

        return false
    }
}
