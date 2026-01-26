package com.household.account.service

import android.app.Notification
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.household.account.QuickEditActivity
import com.household.account.data.CategoryRepository
import com.household.account.data.Expense
import com.household.account.data.ExpenseRepository
import com.household.account.data.MerchantRuleRepository
import com.household.account.parser.KBCardParser
import com.household.account.parser.LocalCurrencyParser
import com.household.account.parser.ParseResult
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
        private const val TAG = "CardNotificationListener"

        // KB Pay 앱 패키지명
        private const val KB_PAY_PACKAGE = "com.kbcard.cxh.appcard"
        private const val KB_CARD_PACKAGE = "com.kbcard.kbkookmincard"

        // 지역화폐 앱 패키지명
        private const val HWASEONG_LOCAL_CURRENCY = "com.mobiletoong.gpay"  // 희망화성지역화폐
        private const val CHAK_WALLET = "com.coocon.chakwallet"  // 착한페이 (화성시)
        private const val GYEONGGI_LOCAL_CURRENCY = "gov.gyeonggi.ggcard"  // 경기지역화폐

        // 지원하는 패키지 목록 (결제 파싱용)
        private val SUPPORTED_PACKAGES = setOf(
            KB_PAY_PACKAGE,
            KB_CARD_PACKAGE,
            HWASEONG_LOCAL_CURRENCY,
            CHAK_WALLET,
            GYEONGGI_LOCAL_CURRENCY
        )

        // 알림 감지 브로드캐스트 액션
        const val ACTION_NOTIFICATION_RECEIVED = "com.household.account.NOTIFICATION_RECEIVED"
        const val EXTRA_EXPENSE_JSON = "expense_json"
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val expenseRepository = ExpenseRepository()
    private val ruleRepository = MerchantRuleRepository()
    private val categoryRepository = CategoryRepository()

    // 중복 알림 방지 (최근 처리한 알림 해시 저장, 30초 유지)
    private val recentNotifications = mutableMapOf<String, Long>()
    private val DUPLICATE_WINDOW_MS = 30_000L

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return

        val packageName = sbn.packageName

        // 결제 파싱 지원 앱인지 확인
        if (packageName !in SUPPORTED_PACKAGES) {
            return
        }

        Log.d(TAG, "결제 알림 감지: $packageName")

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

            Log.d(TAG, "알림 내용: $fullText")

            // 빈 알림 무시
            if (fullText.isEmpty()) {
                Log.d(TAG, "빈 알림 무시")
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
                    Log.d(TAG, "중복 알림 무시: $notificationKey")
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

            if (result.success && result.expense != null) {
                Log.i(TAG, "파싱 성공: ${result.expense}")

                // 저장된 규칙으로 지출 정보 매핑
                serviceScope.launch {
                    try {
                        val householdId = HouseholdPreferences.getHouseholdKey(applicationContext)

                        if (householdId.isEmpty()) {
                            Log.w(TAG, "householdId가 설정되지 않음 - 저장 건너뜀")
                            return@launch
                        }

                        // 규칙 매핑 결과 조회 (가맹점명, 카테고리, 메모 모두 매핑)
                        val mappingResult = ruleRepository.findMappingForMerchant(householdId, result.expense.merchant)

                        val expenseToSave = if (mappingResult != null) {
                            result.expense.copy(
                                merchant = mappingResult.mappedMerchant,
                                category = mappingResult.mappedCategory.name,
                                memo = mappingResult.mappedMemo.ifEmpty { result.expense.memo },
                                householdId = householdId
                            )
                        } else {
                            // 규칙이 없으면 "기타" 카테고리로 저장 (동적 조회)
                            val defaultCategoryKey = categoryRepository.getDefaultCategoryKey(householdId)
                            result.expense.copy(category = defaultCategoryKey, householdId = householdId)
                        }

                        val docId = expenseRepository.addExpense(expenseToSave)
                        val originalMerchant = result.expense.merchant
                        val mappedInfo = if (mappingResult != null && originalMerchant != expenseToSave.merchant) {
                            " (원본: $originalMerchant)"
                        } else ""
                        Log.d(TAG, "Firebase 저장 완료 - householdId: $householdId, 가맹점: ${expenseToSave.merchant}$mappedInfo, 카테고리: ${expenseToSave.category}, ID: $docId")

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
                        Log.e(TAG, "Firebase 저장 실패", e)
                    }
                }
            } else {
                Log.w(TAG, "파싱 실패: ${result.errorMessage}")
                Log.w(TAG, "원본 알림 [$packageName]: $fullText")
            }

        } catch (e: Exception) {
            Log.e(TAG, "알림 처리 중 오류", e)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // 알림 제거 시 특별한 처리 없음
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.d(TAG, "NotificationListener 연결됨")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.d(TAG, "NotificationListener 연결 해제됨")
    }

    /**
     * 빠른 편집 화면 바로 띄우기 (다른 앱 위에 오버레이)
     */
    private fun launchQuickEditActivity(expense: Expense) {
        try {
            // 다른 앱 위에 표시 권한 확인
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M &&
                !android.provider.Settings.canDrawOverlays(applicationContext)) {
                Log.w(TAG, "다른 앱 위에 표시 권한이 없음")
                return
            }

            val intent = Intent(this, QuickEditActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                        Intent.FLAG_ACTIVITY_NO_HISTORY
                putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, expense.id)
                putExtra(QuickEditActivity.EXTRA_MERCHANT, expense.merchant)
                putExtra(QuickEditActivity.EXTRA_AMOUNT, expense.amount)
                putExtra(QuickEditActivity.EXTRA_DATE, expense.date)
                putExtra(QuickEditActivity.EXTRA_TIME, expense.time)
                putExtra(QuickEditActivity.EXTRA_CATEGORY, expense.category)
            }
            startActivity(intent)
            Log.d(TAG, "빠른 편집 화면 실행: ${expense.merchant}")
        } catch (e: Exception) {
            Log.e(TAG, "빠른 편집 화면 실행 실패", e)
        }
    }

}
