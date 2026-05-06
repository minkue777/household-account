package com.household.account.service

import android.app.Notification
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.household.account.QuickEditActivity
import com.household.account.data.BalanceRepository
import com.household.account.data.CategoryRepository
import com.household.account.data.Expense
import com.household.account.data.ExpenseRepository
import com.household.account.data.MerchantRuleRepository
import com.household.account.data.NotificationDebugLogRepository
import com.household.account.data.RegisteredCardRepository
import com.household.account.parser.CityGasBillParser
import com.household.account.parser.DaejeonLocalCurrencyParser
import com.household.account.parser.DigitalOnnuriParser
import com.household.account.parser.ExpenseEventType
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
import com.household.account.util.CardLabelFormatter
import com.household.account.util.HouseholdPreferences
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

    private enum class NotificationSource {
        KB,
        NH,
        NAVER_PAY,
        TOSS_BANK,
        KAKAOPAY,
        DIGITAL_ONNURI,
        PAYBOOC_ISP,
        SMS,
        SAMSUNG,
        LOTTE,
        GYEONGGI_LOCAL_CURRENCY,
        DAEJEON_LOCAL_CURRENCY,
        SEJONG_LOCAL_CURRENCY,
        CITY_GAS_BILL
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val expenseRepository = ExpenseRepository()
    private val ruleRepository = MerchantRuleRepository()
    private val categoryRepository = CategoryRepository()
    private val balanceRepository = BalanceRepository()
    private val registeredCardRepository = RegisteredCardRepository()
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

            val source = detectSource(packageName, fullText) ?: return

            val notificationKey = "${packageName}_${fullText.hashCode()}"
            val now = System.currentTimeMillis()
            if (rememberRecentKey(recentNotifications, notificationKey, now, duplicateWindowMs)) {
                return
            }

            val result: ParseResult = when (source) {
                NotificationSource.KB -> KBCardParser.parse(fullText, postedAtMillis = sbn.postTime)
                NotificationSource.NH -> NHPayParser.parse(fullText)
                NotificationSource.NAVER_PAY -> NaverPayParser.parse(fullText, sbn.postTime)
                NotificationSource.TOSS_BANK -> TossBankParser.parse(fullText, sbn.postTime)
                NotificationSource.KAKAOPAY -> KakaoPayParser.parse(fullText, sbn.postTime)
                NotificationSource.DIGITAL_ONNURI -> DigitalOnnuriParser.parse(fullText, sbn.postTime)
                NotificationSource.PAYBOOC_ISP -> PayboocISPParser.parse(fullText, sbn.postTime)
                NotificationSource.SMS -> SmsNotificationParser.parse(fullText, sbn.postTime)
                NotificationSource.SAMSUNG -> SamsungCardParser.parse(fullText)
                NotificationSource.LOTTE -> LotteCardParser.parse(fullText)
                NotificationSource.GYEONGGI_LOCAL_CURRENCY -> GyeonggiLocalCurrencyParser.parse(fullText)
                NotificationSource.DAEJEON_LOCAL_CURRENCY -> DaejeonLocalCurrencyParser.parse(fullText)
                NotificationSource.SEJONG_LOCAL_CURRENCY -> SejongLocalCurrencyParser.parse(fullText, sbn.postTime)
                NotificationSource.CITY_GAS_BILL -> CityGasBillParser.parse(fullText, sbn.postTime)
            }

            if (
                source == NotificationSource.GYEONGGI_LOCAL_CURRENCY ||
                source == NotificationSource.DAEJEON_LOCAL_CURRENCY ||
                source == NotificationSource.SEJONG_LOCAL_CURRENCY
            ) {
                saveLocalCurrencyBalanceIfPresent(source, fullText)
            }

            if (result.success && result.expense != null) {
                when (result.eventType) {
                    ExpenseEventType.APPROVAL -> saveExpenseAndLaunchQuickEdit(result.expense)
                    ExpenseEventType.CANCELLATION -> cancelMatchingExpense(result.expense)
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

    private fun detectSource(packageName: String, fullText: String): NotificationSource? {
        return when {
            packageName in knownKbPackages || KBCardParser.matches(fullText) -> NotificationSource.KB
            packageName in knownNhPackages || NHPayParser.matches(fullText) -> NotificationSource.NH
            packageName in knownNaverPayPackages || NaverPayParser.matches(fullText) ->
                NotificationSource.NAVER_PAY
            packageName in knownTossPackages || TossBankParser.matches(fullText) ->
                NotificationSource.TOSS_BANK
            packageName in knownKakaoPayPackages || KakaoPayParser.matches(fullText) ->
                NotificationSource.KAKAOPAY
            packageName in knownDigitalOnnuriPackages || DigitalOnnuriParser.matches(fullText) ->
                NotificationSource.DIGITAL_ONNURI
            packageName in knownPayboocPackages || PayboocISPParser.matches(fullText) ->
                NotificationSource.PAYBOOC_ISP
            SmsNotificationParser.matches(packageName, fullText) -> NotificationSource.SMS
            SamsungCardParser.matches(fullText) -> NotificationSource.SAMSUNG
            LotteCardParser.matches(fullText) -> NotificationSource.LOTTE
            packageName in knownGyeonggiLocalCurrencyPackages || GyeonggiLocalCurrencyParser.matches(fullText) ->
                NotificationSource.GYEONGGI_LOCAL_CURRENCY
            packageName in knownDaejeonLocalCurrencyPackages || DaejeonLocalCurrencyParser.matches(fullText) ->
                NotificationSource.DAEJEON_LOCAL_CURRENCY
            packageName in knownSejongLocalCurrencyPackages || SejongLocalCurrencyParser.matches(fullText) ->
                NotificationSource.SEJONG_LOCAL_CURRENCY
            packageName == KAKAO_TALK_PACKAGE && CityGasBillParser.matches(fullText) ->
                NotificationSource.CITY_GAS_BILL
            else -> null
        }
    }

    private fun detectSourceByPackage(packageName: String): NotificationSource? {
        return when {
            packageName in knownKbPackages -> NotificationSource.KB
            packageName in knownNhPackages -> NotificationSource.NH
            packageName in knownNaverPayPackages -> NotificationSource.NAVER_PAY
            packageName in knownTossPackages -> NotificationSource.TOSS_BANK
            packageName in knownKakaoPayPackages -> NotificationSource.KAKAOPAY
            packageName in knownDigitalOnnuriPackages -> NotificationSource.DIGITAL_ONNURI
            packageName in knownPayboocPackages -> NotificationSource.PAYBOOC_ISP
            packageName in knownGyeonggiLocalCurrencyPackages ->
                NotificationSource.GYEONGGI_LOCAL_CURRENCY
            packageName in knownDaejeonLocalCurrencyPackages ->
                NotificationSource.DAEJEON_LOCAL_CURRENCY
            packageName in knownSejongLocalCurrencyPackages ->
                NotificationSource.SEJONG_LOCAL_CURRENCY
            SmsNotificationParser.isSupportedPackage(packageName) -> NotificationSource.SMS
            else -> null
        }
    }

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
            source == NotificationSource.TOSS_BANK.name &&
            normalizedTitle.isNotEmpty() &&
            tossWalkingTitlePattern.matches(normalizedTitle)
        ) {
            return
        }

        serviceScope.launch {
            try {
                notificationDebugLogRepository.saveRawLog(
                    householdId = HouseholdPreferences.getHouseholdKey(applicationContext),
                    memberName = HouseholdPreferences.getMemberName(applicationContext),
                    packageName = packageName,
                    source = source,
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
        if (packageName == KAKAO_TALK_PACKAGE) {
            return detectSource(packageName, fullText)?.name
        }

        return detectSourceByPackage(packageName)?.name
            ?: debugOnlyNotificationPackages[packageName]
    }

    private fun saveLocalCurrencyBalanceIfPresent(
        source: NotificationSource,
        fullText: String
    ) {
        val balanceResult: LocalCurrencyBalanceResult = when (source) {
            NotificationSource.GYEONGGI_LOCAL_CURRENCY ->
                GyeonggiLocalCurrencyParser.parseBalance(fullText)
            NotificationSource.DAEJEON_LOCAL_CURRENCY ->
                DaejeonLocalCurrencyParser.parseBalance(fullText)
            NotificationSource.SEJONG_LOCAL_CURRENCY ->
                SejongLocalCurrencyParser.parseBalance(fullText)
            else -> return
        }
        val balance = balanceResult.balance ?: return

        serviceScope.launch {
            try {
                val householdId = HouseholdPreferences.getHouseholdKey(applicationContext)
                if (householdId.isNotEmpty()) {
                    balanceRepository.saveLocalCurrencyBalance(
                        householdId,
                        balance,
                        balanceResult.currencyType ?: "지역화폐"
                    )
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun saveExpenseAndLaunchQuickEdit(expense: Expense) {
        serviceScope.launch {
            try {
                val householdId = HouseholdPreferences.getHouseholdKey(applicationContext)
                if (householdId.isEmpty()) {
                    return@launch
                }

                val mappingResult = ruleRepository.findMappingForMerchant(householdId, expense.merchant)

                val isBillExpense = expense.cardType == CityGasBillParser.CARD_TYPE

                val expenseToSave = if (mappingResult != null) {
                    expense.copy(
                        merchant = mappingResult.mappedMerchant,
                        category = mappingResult.mappedCategoryKey,
                        memo = mappingResult.mappedMemo.ifEmpty { expense.memo },
                        householdId = householdId
                    )
                } else if (isBillExpense) {
                    expense.copy(
                        householdId = householdId,
                        cardLastFour = ""
                    )
                } else {
                    val defaultCategoryKey = categoryRepository.getDefaultCategoryKey(householdId)
                    expense.copy(
                        category = defaultCategoryKey,
                        householdId = householdId
                    )
                }

                val normalizedExpenseToSave = if (isBillExpense) {
                    expenseToSave
                } else {
                    val memberName = HouseholdPreferences.getMemberName(applicationContext)
                    val matchedRegisteredCard = registeredCardRepository.findMatchedRegisteredCard(
                        householdId = householdId,
                        owner = memberName,
                        cardValue = expenseToSave.cardLastFour
                    )
                    if (matchedRegisteredCard == null) {
                        return@launch
                    }

                    val normalizedExpenseToken = CardLabelFormatter.normalizeCardToken(expenseToSave.cardLastFour)
                    val normalizedRegisteredToken = CardLabelFormatter.normalizeCardToken(
                        matchedRegisteredCard.cardLastFour
                    )

                    if (
                        matchedRegisteredCard.cardLastFour.isNotBlank() &&
                        normalizedExpenseToken != null &&
                        normalizedRegisteredToken != null &&
                        normalizedExpenseToken != normalizedRegisteredToken
                    ) {
                        expenseToSave.copy(
                            cardLastFour = CardLabelFormatter.formatCardLabel(
                                matchedRegisteredCard.cardLabel,
                                matchedRegisteredCard.cardLastFour
                            )
                        )
                    } else {
                        expenseToSave
                    }
                }

                val duplicatedExpense = expenseRepository.findDuplicateExpenseForRegistration(
                    householdId = householdId,
                    expense = normalizedExpenseToSave
                )
                if (duplicatedExpense != null) {
                    return@launch
                }

                val documentId = expenseRepository.addExpense(normalizedExpenseToSave)
                if (documentId.isNotEmpty()) {
                    launchQuickEditActivity(
                        normalizedExpenseToSave.copy(
                            id = documentId,
                            category = normalizedExpenseToSave.category.lowercase()
                        )
                    )
                }

                sendBroadcast(Intent(ACTION_NOTIFICATION_RECEIVED))
            } catch (_: Exception) {
            }
        }
    }

    private fun cancelMatchingExpense(expense: Expense) {
        serviceScope.launch {
            try {
                val householdId = HouseholdPreferences.getHouseholdKey(applicationContext)
                if (householdId.isEmpty()) {
                    return@launch
                }

                val mappingResult = ruleRepository.findMappingForMerchant(householdId, expense.merchant)
                val expenseToCancel = if (mappingResult != null) {
                    expense.copy(
                        merchant = mappingResult.mappedMerchant,
                        householdId = householdId
                    )
                } else {
                    expense.copy(householdId = householdId)
                }

                val matchedExpense = expenseRepository.findExpenseForCancellation(
                    householdId = householdId,
                    expense = expenseToCancel
                )

                val expensesToDelete = when {
                    matchedExpense?.splitGroupId?.isNotBlank() == true -> {
                        expenseRepository.getExpensesBySplitGroup(
                            householdId = householdId,
                            splitGroupId = matchedExpense.splitGroupId
                        ).ifEmpty { listOf(matchedExpense) }
                    }

                    matchedExpense != null -> listOf(matchedExpense)
                    else -> expenseRepository.findSplitGroupExpensesForCancellation(
                        householdId = householdId,
                        expense = expenseToCancel
                    )
                }

                if (expensesToDelete.isEmpty()) {
                    return@launch
                }

                expensesToDelete.forEach { expenseRepository.deleteExpense(it.id) }
                sendBroadcast(Intent(ACTION_NOTIFICATION_RECEIVED))
            } catch (_: Exception) {
            }
        }
    }

    private fun launchQuickEditActivity(expense: Expense) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M &&
                !Settings.canDrawOverlays(applicationContext)
            ) {
                return
            }

            val intent = Intent(this, QuickEditActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
                putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, expense.id)
                putExtra(QuickEditActivity.EXTRA_MERCHANT, expense.merchant)
                putExtra(QuickEditActivity.EXTRA_AMOUNT, expense.amount)
                putExtra(QuickEditActivity.EXTRA_DATE, expense.date)
                putExtra(QuickEditActivity.EXTRA_TIME, expense.time)
                putExtra(QuickEditActivity.EXTRA_CATEGORY, expense.category)
                putExtra(QuickEditActivity.EXTRA_MEMO, expense.memo)
            }
            startActivity(intent)
        } catch (_: Exception) {
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
