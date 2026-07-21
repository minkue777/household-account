package com.household.account.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.household.account.data.NotificationDebugLogRepository
import com.household.account.paymentcapture.AndroidCaptureDelivery
import com.household.account.paymentcapture.CaptureEnvelopeFactory
import com.household.account.paymentcapture.PaymentSourceRegistry
import com.household.account.paymentcapture.RegisteredNotificationSource
import com.household.account.parser.CityGasBillParser
import com.household.account.parser.DaejeonLocalCurrencyParser
import com.household.account.parser.DigitalOnnuriParser
import com.household.account.parser.GyeonggiLocalCurrencyParser
import com.household.account.parser.KakaoPayParser
import com.household.account.parser.KBCardParser
import com.household.account.parser.LocalCurrencyBalanceResult
import com.household.account.parser.LotteCardParser
import com.household.account.parser.NHPayParser
import com.household.account.parser.NaverPayParser
import com.household.account.parser.PayboocISPParser
import com.household.account.parser.ParseResult
import com.household.account.parser.SamsungCardParser
import com.household.account.parser.SejongLocalCurrencyParser
import com.household.account.parser.SmsNotificationParser
import com.household.account.parser.TossBankParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class CardNotificationListenerService : NotificationListenerService() {

    companion object {
        private const val KB_PAY_PACKAGE = "com.kbcard.cxh.appcard"
        private const val KB_CARD_PACKAGE = "com.kbcard.kbkookmincard"
        private const val NH_PAY_PACKAGE = "nh.smart.nhallonepay"
        private const val NAVER_PAY_PACKAGE = "com.naverfin.payapp"
        private const val TOSS_PACKAGE = "viva.republica.toss"
        private const val KAKAOPAY_PACKAGE = "com.kakaopay.app"
        private const val KAKAO_TALK_PACKAGE = "com.kakao.talk"
        private const val DIGITAL_ONNURI_PACKAGE = "com.komsco.kpay"
        private const val PAYBOOC_ISP_PACKAGE = "kvp.jjy.MispAndroid320"

        private const val HWASEONG_LOCAL_CURRENCY = "com.mobiletoong.gpay"
        private const val CHAK_WALLET = "com.coocon.chakwallet"
        private const val GYEONGGI_LOCAL_CURRENCY = "gov.gyeonggi.ggcard"
        private const val DAEJEON_LOVE_CARD = "kr.co.nmcs.daejeonpay"
        private const val SEJONG_YEOMINPAY = "gov.sejong.yeominpay"

        private val knownKbPackages = setOf(
            KB_PAY_PACKAGE,
            KB_CARD_PACKAGE
        )

        private val knownNhPackages = setOf(NH_PAY_PACKAGE)
        private val knownNaverPayPackages = setOf(NAVER_PAY_PACKAGE)
        private val knownTossPackages = setOf(TOSS_PACKAGE)
        private val knownKakaoPayPackages = setOf(KAKAOPAY_PACKAGE)
        private val knownDigitalOnnuriPackages = setOf(DIGITAL_ONNURI_PACKAGE)
        private val knownPayboocPackages = setOf(PAYBOOC_ISP_PACKAGE)
        private val knownGyeonggiLocalCurrencyPackages = setOf(
            HWASEONG_LOCAL_CURRENCY,
            CHAK_WALLET,
            GYEONGGI_LOCAL_CURRENCY
        )
        private val knownDaejeonLocalCurrencyPackages = setOf(
            DAEJEON_LOVE_CARD
        )
        private val knownSejongLocalCurrencyPackages = setOf(
            SEJONG_YEOMINPAY
        )

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
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val notificationDebugLogRepository = NotificationDebugLogRepository()

    private val recentNotifications = mutableMapOf<String, Long>()
    private val duplicateWindowMs = 30_000L

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return

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

            saveRawNotificationLogIfNeeded(
                packageName = packageName,
                title = title,
                text = text,
                bigText = bigText,
                textLines = textLines,
                fullText = fullText,
                postedAtMillis = sbn.postTime
            )

            val source = detectSource(packageName) ?: return

            val notificationKey = "${packageName}_${fullText.hashCode()}"
            val now = System.currentTimeMillis()
            if (rememberRecentKey(recentNotifications, notificationKey, now, duplicateWindowMs)) {
                return
            }

            val result: ParseResult = when (source) {
                RegisteredNotificationSource.KB -> KBCardParser.parse(fullText, postedAtMillis = sbn.postTime)
                RegisteredNotificationSource.NH -> NHPayParser.parse(fullText, postedAtMillis = sbn.postTime)
                RegisteredNotificationSource.NAVER_PAY -> NaverPayParser.parse(fullText, sbn.postTime)
                RegisteredNotificationSource.TOSS_BANK -> TossBankParser.parse(fullText, sbn.postTime)
                RegisteredNotificationSource.KAKAOPAY -> KakaoPayParser.parse(fullText, sbn.postTime)
                RegisteredNotificationSource.DIGITAL_ONNURI -> DigitalOnnuriParser.parse(fullText, sbn.postTime)
                RegisteredNotificationSource.PAYBOOC_ISP -> PayboocISPParser.parse(fullText, sbn.postTime)
                RegisteredNotificationSource.SMS -> SmsNotificationParser.parse(fullText, sbn.postTime)
                RegisteredNotificationSource.SAMSUNG -> SamsungCardParser.parse(fullText, postedAtMillis = sbn.postTime)
                RegisteredNotificationSource.LOTTE -> LotteCardParser.parse(fullText, postedAtMillis = sbn.postTime)
                RegisteredNotificationSource.GYEONGGI_LOCAL_CURRENCY -> GyeonggiLocalCurrencyParser.parse(fullText, sbn.postTime)
                RegisteredNotificationSource.DAEJEON_LOCAL_CURRENCY -> DaejeonLocalCurrencyParser.parse(fullText, sbn.postTime)
                RegisteredNotificationSource.SEJONG_LOCAL_CURRENCY -> SejongLocalCurrencyParser.parse(fullText, sbn.postTime)
                RegisteredNotificationSource.CITY_GAS_BILL -> CityGasBillParser.parse(fullText, sbn.postTime)
            }

            val balanceResult = parseBalance(source, fullText)
            val envelope = CaptureEnvelopeFactory.create(
                packageName = packageName,
                source = source,
                postedAtMillis = sbn.postTime,
                rawNotificationText = fullText,
                expense = result.expense.takeIf { result.success },
                eventType = result.eventType.takeIf { result.success },
                balance = balanceResult
            ) ?: return

            serviceScope.launch {
                runCatching {
                    AndroidCaptureDelivery.enqueueAndFlush(applicationContext, envelope)
                }
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
        if (packageName == KAKAO_TALK_PACKAGE && !CityGasBillParser.matches(fullText)) {
            return null
        }
        return detectSource(packageName)?.name
            ?: debugOnlyNotificationPackages[packageName]
    }

    private fun parseBalance(
        source: RegisteredNotificationSource,
        fullText: String
    ): LocalCurrencyBalanceResult? {
        return when (source) {
            RegisteredNotificationSource.GYEONGGI_LOCAL_CURRENCY ->
                GyeonggiLocalCurrencyParser.parseBalance(fullText)
            RegisteredNotificationSource.DAEJEON_LOCAL_CURRENCY ->
                DaejeonLocalCurrencyParser.parseBalance(fullText)
            RegisteredNotificationSource.SEJONG_LOCAL_CURRENCY ->
                SejongLocalCurrencyParser.parseBalance(fullText)
            else -> null
        }
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
