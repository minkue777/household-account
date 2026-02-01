package com.household.account.service

import android.app.Notification
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.household.account.QuickEditActivity
import com.household.account.data.BalanceRepository
import com.household.account.data.CategoryRepository
import com.household.account.data.Expense
import com.household.account.data.ExpenseRepository
import com.household.account.data.MerchantRuleRepository
import com.household.account.parser.KBCardParser
import com.household.account.parser.LocalCurrencyParser
import com.household.account.parser.ParseResult
import com.household.account.parser.TossKakaoParser
import com.household.account.parser.MGSaemaeulParser
import com.household.account.util.HouseholdPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 카드사 알림을 감지하는 서비스
 *
 * 사용자가 설정 > 알림 접근 권한에서 이 앱을 활성화해야 동작합니다.
 */
class CardNotificationListenerService : NotificationListenerService() {

    companion object {
        // KB Pay 앱 패키지명
        private const val KB_PAY_PACKAGE = "com.kbcard.cxh.appcard"
        private const val KB_CARD_PACKAGE = "com.kbcard.kbkookmincard"

        // 지역화폐 앱 패키지명
        private const val HWASEONG_LOCAL_CURRENCY = "com.mobiletoong.gpay"  // 희망화성지역화폐
        private const val CHAK_WALLET = "com.coocon.chakwallet"  // 착한페이 (화성시)
        private const val GYEONGGI_LOCAL_CURRENCY = "gov.gyeonggi.ggcard"  // 경기지역화폐

        // 카카오톡 패키지명 (토스 정산 알림용)
        private const val KAKAO_TALK_PACKAGE = "com.kakao.talk"

        // SMS 앱 패키지명 (새마을금고 정산 알림용)
        private const val SAMSUNG_MESSAGES_PACKAGE = "com.samsung.android.messaging"
        private const val GOOGLE_MESSAGES_PACKAGE = "com.google.android.apps.messaging"

        // 지원하는 패키지 목록 (결제 파싱용)
        private val SUPPORTED_PACKAGES = setOf(
            KB_PAY_PACKAGE,
            KB_CARD_PACKAGE,
            HWASEONG_LOCAL_CURRENCY,
            CHAK_WALLET,
            GYEONGGI_LOCAL_CURRENCY
        )

        // 정산 알림 감지용 패키지 목록 (카카오톡 토스뱅크)
        private val SETTLEMENT_PACKAGES = setOf(
            KAKAO_TALK_PACKAGE
        )

        // SMS 앱 패키지 목록 (새마을금고 입금 알림)
        private val SMS_PACKAGES = setOf(
            SAMSUNG_MESSAGES_PACKAGE,
            GOOGLE_MESSAGES_PACKAGE
        )

        // 알림 감지 브로드캐스트 액션
        const val ACTION_NOTIFICATION_RECEIVED = "com.household.account.NOTIFICATION_RECEIVED"
        const val EXTRA_EXPENSE_JSON = "expense_json"
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val expenseRepository = ExpenseRepository()
    private val ruleRepository = MerchantRuleRepository()
    private val categoryRepository = CategoryRepository()
    private val balanceRepository = BalanceRepository()

    // 중복 알림 방지 (최근 처리한 알림 해시 저장, 30초 유지)
    private val recentNotifications = mutableMapOf<String, Long>()
    private val DUPLICATE_WINDOW_MS = 30_000L

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return

        val packageName = sbn.packageName

        // 디버그: 모든 알림 패키지명 로그
        serviceScope.launch {
            val householdId = HouseholdPreferences.getHouseholdKey(applicationContext)
            saveDebugLog(householdId, "NOTIFICATION", mapOf(
                "package" to packageName,
                "inSMS" to (packageName in SMS_PACKAGES),
                "inSettlement" to (packageName in SETTLEMENT_PACKAGES)
            ))
        }

        // 정산 알림 처리 (카카오톡 토스뱅크)
        if (packageName in SETTLEMENT_PACKAGES) {
            handleSettlementNotification(sbn)
            return
        }

        // 정산 알림 처리 (SMS - 새마을금고)
        if (packageName in SMS_PACKAGES) {
            handleSmsSettlementNotification(sbn)
            return
        }

        // 결제 파싱 지원 앱인지 확인
        if (packageName !in SUPPORTED_PACKAGES) {
            return
        }

        try {
            val notification = sbn.notification
            val extras = notification.extras

            // 알림 텍스트 추출
            val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
            val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""

            // 전체 알림 텍스트 조합 (title 항상 포함)
            val fullText = buildString {
                if (title.isNotEmpty()) {
                    append(title)
                    append("\n")
                }
                if (bigText.isNotEmpty()) {
                    append(bigText)
                } else if (text.isNotEmpty()) {
                    append(text)
                }
            }.trim()

            // 빈 알림 무시
            if (fullText.isEmpty()) {
                return
            }

            // 중복 알림 체크 (금액+가맹점 조합으로 30초 내 중복 방지)
            val notificationKey = "${packageName}_${fullText.hashCode()}"
            val now = System.currentTimeMillis()
            synchronized(recentNotifications) {
                // 오래된 항목 정리
                recentNotifications.entries.removeIf { now - it.value > DUPLICATE_WINDOW_MS }
                // 중복 체크
                if (recentNotifications.containsKey(notificationKey)) {
                    return
                }
                recentNotifications[notificationKey] = now
            }

            // 앱 종류에 따라 파서 선택
            val result: ParseResult = when (packageName) {
                KB_PAY_PACKAGE, KB_CARD_PACKAGE -> KBCardParser.parse(fullText)
                HWASEONG_LOCAL_CURRENCY, CHAK_WALLET, GYEONGGI_LOCAL_CURRENCY -> LocalCurrencyParser.parse(fullText)
                else -> ParseResult(false, errorMessage = "지원하지 않는 앱")
            }

            // 지역화폐인 경우 잔액도 파싱해서 저장
            if (packageName in setOf(HWASEONG_LOCAL_CURRENCY, CHAK_WALLET, GYEONGGI_LOCAL_CURRENCY)) {
                val balanceResult = LocalCurrencyParser.parseBalance(fullText)
                if (balanceResult.balance != null) {
                    serviceScope.launch {
                        try {
                            val householdId = HouseholdPreferences.getHouseholdKey(applicationContext)
                            if (householdId.isNotEmpty()) {
                                balanceRepository.saveLocalCurrencyBalance(
                                    householdId,
                                    balanceResult.balance,
                                    balanceResult.currencyType ?: "지역화폐"
                                )
                            }
                        } catch (e: Exception) {
                            // ignored
                        }
                    }
                }
            }

            if (result.success && result.expense != null) {
                // 저장된 규칙으로 지출 정보 매핑
                serviceScope.launch {
                    try {
                        val householdId = HouseholdPreferences.getHouseholdKey(applicationContext)

                        if (householdId.isEmpty()) {
                            return@launch
                        }

                        // 규칙 매핑 결과 조회 (가맹점명, 카테고리, 메모 모두 매핑)
                        val mappingResult = ruleRepository.findMappingForMerchant(householdId, result.expense.merchant)

                        val expenseToSave = if (mappingResult != null) {
                            result.expense.copy(
                                merchant = mappingResult.mappedMerchant,
                                category = mappingResult.mappedCategoryKey,
                                memo = mappingResult.mappedMemo.ifEmpty { result.expense.memo },
                                householdId = householdId
                            )
                        } else {
                            // 규칙이 없으면 "기타" 카테고리로 저장 (동적 조회)
                            val defaultCategoryKey = categoryRepository.getDefaultCategoryKey(householdId)
                            result.expense.copy(category = defaultCategoryKey, householdId = householdId)
                        }

                        val docId = expenseRepository.addExpense(expenseToSave)

                        // 빠른 편집 화면 바로 띄우기 (카테고리는 소문자로 변환)
                        if (docId.isNotEmpty()) {
                            launchQuickEditActivity(expenseToSave.copy(
                                id = docId,
                                category = expenseToSave.category.lowercase()
                            ))
                        }

                        // 브로드캐스트로 UI에 알림
                        sendBroadcast(Intent(ACTION_NOTIFICATION_RECEIVED))

                    } catch (e: Exception) {
                        // ignored
                    }
                }
            }

        } catch (e: Exception) {
            // ignored
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // 알림 제거 시 특별한 처리 없음
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
    }

    /**
     * 빠른 편집 화면 바로 띄우기 (다른 앱 위에 오버레이)
     */
    private fun launchQuickEditActivity(expense: Expense) {
        try {
            // 다른 앱 위에 표시 권한 확인
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M &&
                !android.provider.Settings.canDrawOverlays(applicationContext)) {
                return
            }

            val intent = Intent(this, QuickEditActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
                putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, expense.id)
                putExtra(QuickEditActivity.EXTRA_MERCHANT, expense.merchant)
                putExtra(QuickEditActivity.EXTRA_AMOUNT, expense.amount)
                putExtra(QuickEditActivity.EXTRA_DATE, expense.date)
                putExtra(QuickEditActivity.EXTRA_TIME, expense.time)
                putExtra(QuickEditActivity.EXTRA_CATEGORY, expense.category)
            }
            startActivity(intent)
        } catch (e: Exception) {
            // ignored
        }
    }

    /**
     * 정산 알림 처리 (카카오톡 토스뱅크 출금 알림)
     */
    private fun handleSettlementNotification(sbn: StatusBarNotification) {
        try {
            val notification = sbn.notification
            val extras = notification.extras

            val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
            val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""

            // 토스뱅크 알림인지 확인
            if (!TossKakaoParser.isTossBankMessage(title, title)) {
                return
            }

            val fullText = buildString {
                append(title)
                append("\n")
                if (bigText.isNotEmpty()) {
                    append(bigText)
                } else {
                    append(text)
                }
            }

            // 출금 정보 파싱
            val withdrawalInfo = TossKakaoParser.parseWithdrawal(fullText) ?: return

            // 미정산 지출 매칭 및 정산 완료 처리
            serviceScope.launch {
                try {
                    val householdId = HouseholdPreferences.getHouseholdKey(applicationContext)
                    if (householdId.isEmpty()) {
                        return@launch
                    }

                    // 금액이 일치하는 미정산 지출 찾기
                    val matchedExpense = expenseRepository.findUnsettledExpenseByAmount(
                        householdId,
                        withdrawalInfo.amount
                    )

                    if (matchedExpense != null) {
                        // 정산 완료 처리 (토스뱅크 카톡 = 이진선)
                        expenseRepository.markAsSettled(matchedExpense.id, "이진선")
                    }
                } catch (e: Exception) {
                    // ignored
                }
            }
        } catch (e: Exception) {
            // ignored
        }
    }

    /**
     * SMS 정산 알림 처리 (새마을금고 입금 알림)
     */
    private fun handleSmsSettlementNotification(sbn: StatusBarNotification) {
        serviceScope.launch {
            try {
                val notification = sbn.notification
                val extras = notification.extras

                val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
                val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
                val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""

                // 새마을금고 메시지인지 확인
                val fullText = buildString {
                    if (title.isNotEmpty()) {
                        append(title)
                        append("\n")
                    }
                    if (bigText.isNotEmpty()) {
                        append(bigText)
                    } else {
                        append(text)
                    }
                }

                val householdId = HouseholdPreferences.getHouseholdKey(applicationContext)

                // 디버그 로그: SMS 알림 수신
                saveDebugLog(householdId, "SMS_RECEIVED", mapOf(
                    "package" to sbn.packageName,
                    "title" to title,
                    "text" to text,
                    "fullText" to fullText
                ))

                if (!MGSaemaeulParser.isMGSaemaeulMessage(title, fullText)) {
                    saveDebugLog(householdId, "SMS_NOT_MG", mapOf("reason" to "not MG message"))
                    return@launch
                }

                // 입금 정보 파싱
                val depositInfo = MGSaemaeulParser.parseDeposit(fullText)
                if (depositInfo == null) {
                    saveDebugLog(householdId, "SMS_PARSE_FAIL", mapOf("fullText" to fullText))
                    return@launch
                }

                saveDebugLog(householdId, "SMS_PARSED", mapOf(
                    "amount" to depositInfo.amount,
                    "balance" to depositInfo.balance
                ))

                if (householdId.isEmpty()) {
                    saveDebugLog(householdId, "SMS_NO_HOUSEHOLD", mapOf())
                    return@launch
                }

                // 금액이 일치하는 미정산 지출 찾기
                val matchedExpense = expenseRepository.findUnsettledExpenseByAmount(
                    householdId,
                    depositInfo.amount
                ) { event, data -> saveDebugLog(householdId, event, data) }

                if (matchedExpense != null) {
                    saveDebugLog(householdId, "SMS_MATCHED", mapOf(
                        "expenseId" to matchedExpense.id,
                        "merchant" to matchedExpense.merchant,
                        "amount" to matchedExpense.amount
                    ))
                    // 정산 완료 처리 (새마을금고 SMS = 이민규)
                    expenseRepository.markAsSettled(matchedExpense.id, "이민규")
                    saveDebugLog(householdId, "SMS_SETTLED", mapOf("expenseId" to matchedExpense.id))
                } else {
                    saveDebugLog(householdId, "SMS_NO_MATCH", mapOf("amount" to depositInfo.amount))
                }
            } catch (e: Exception) {
                saveDebugLog("", "SMS_ERROR", mapOf("error" to (e.message ?: "unknown")))
            }
        }
    }

    /**
     * Firestore에 디버그 로그 저장
     */
    private fun saveDebugLog(householdId: String, event: String, data: Map<String, Any>) {
        try {
            val firestore = com.google.firebase.firestore.FirebaseFirestore.getInstance()
            val logData = mutableMapOf<String, Any>(
                "event" to event,
                "timestamp" to com.google.firebase.Timestamp.now(),
                "householdId" to householdId
            )
            logData.putAll(data)
            firestore.collection("debug_logs").add(logData)
        } catch (e: Exception) {
            // ignored
        }
    }

}
