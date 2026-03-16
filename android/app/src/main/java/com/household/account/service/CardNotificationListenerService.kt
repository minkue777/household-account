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
import com.household.account.parser.DaejeonLocalCurrencyParser
import com.household.account.parser.ExpenseEventType
import com.household.account.parser.GyeonggiLocalCurrencyParser
import com.household.account.parser.KBCardParser
import com.household.account.parser.LocalCurrencyBalanceResult
import com.household.account.parser.NHPayParser
import com.household.account.parser.NaverPayParser
import com.household.account.parser.ParseResult
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

        private const val HWASEONG_LOCAL_CURRENCY = "com.mobiletoong.gpay"
        private const val CHAK_WALLET = "com.coocon.chakwallet"
        private const val GYEONGGI_LOCAL_CURRENCY = "gov.gyeonggi.ggcard"
        private const val DAEJEON_LOVE_CARD = "kr.co.nmcs.daejeonpay"

        private val knownKbPackages = setOf(
            KB_PAY_PACKAGE,
            KB_CARD_PACKAGE
        )

        private val knownNhPackages = setOf(NH_PAY_PACKAGE)
        private val knownNaverPayPackages = setOf(NAVER_PAY_PACKAGE)
        private val knownGyeonggiLocalCurrencyPackages = setOf(
            HWASEONG_LOCAL_CURRENCY,
            CHAK_WALLET,
            GYEONGGI_LOCAL_CURRENCY
        )
        private val knownDaejeonLocalCurrencyPackages = setOf(
            DAEJEON_LOVE_CARD
        )

        const val ACTION_NOTIFICATION_RECEIVED = "com.household.account.NOTIFICATION_RECEIVED"
        const val EXTRA_EXPENSE_JSON = "expense_json"
    }

    private enum class NotificationSource {
        KB,
        NH,
        NAVER_PAY,
        GYEONGGI_LOCAL_CURRENCY,
        DAEJEON_LOCAL_CURRENCY
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val expenseRepository = ExpenseRepository()
    private val ruleRepository = MerchantRuleRepository()
    private val categoryRepository = CategoryRepository()
    private val balanceRepository = BalanceRepository()

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

            val fullText = buildString {
                if (title.isNotBlank()) {
                    append(title)
                    append("\n")
                }
                if (bigText.isNotBlank()) {
                    append(bigText)
                } else if (text.isNotBlank()) {
                    append(text)
                }
            }.trim()

            if (fullText.isEmpty()) {
                return
            }

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
                NotificationSource.GYEONGGI_LOCAL_CURRENCY -> GyeonggiLocalCurrencyParser.parse(fullText)
                NotificationSource.DAEJEON_LOCAL_CURRENCY -> DaejeonLocalCurrencyParser.parse(fullText)
            }

            if (
                source == NotificationSource.GYEONGGI_LOCAL_CURRENCY ||
                source == NotificationSource.DAEJEON_LOCAL_CURRENCY
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
            packageName in knownGyeonggiLocalCurrencyPackages || GyeonggiLocalCurrencyParser.matches(fullText) ->
                NotificationSource.GYEONGGI_LOCAL_CURRENCY
            packageName in knownDaejeonLocalCurrencyPackages || DaejeonLocalCurrencyParser.matches(fullText) ->
                NotificationSource.DAEJEON_LOCAL_CURRENCY
            else -> null
        }
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

                val expenseToSave = if (mappingResult != null) {
                    expense.copy(
                        merchant = mappingResult.mappedMerchant,
                        category = mappingResult.mappedCategoryKey,
                        memo = mappingResult.mappedMemo.ifEmpty { expense.memo },
                        householdId = householdId
                    )
                } else {
                    val defaultCategoryKey = categoryRepository.getDefaultCategoryKey(householdId)
                    expense.copy(
                        category = defaultCategoryKey,
                        householdId = householdId
                    )
                }

                val documentId = expenseRepository.addExpense(expenseToSave)
                if (documentId.isNotEmpty()) {
                    launchQuickEditActivity(
                        expenseToSave.copy(
                            id = documentId,
                            category = expenseToSave.category.lowercase()
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
