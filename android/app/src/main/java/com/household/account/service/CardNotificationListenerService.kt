package com.household.account.service

import android.app.Notification
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.household.account.QuickEditActivity
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.data.ExpenseRepository
import com.household.account.data.MerchantRuleRepository
import com.household.account.data.RawNotificationRepository
import com.household.account.parser.KBCardParser
import com.household.account.parser.LocalCurrencyParser
import com.household.account.parser.ParseResult
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

        // 배달앱/쇼핑앱 패키지명 (알림 수집용)
        private const val COUPANG_EATS = "com.coupang.mobile.eats"  // 쿠팡이츠
        private const val COUPANG = "com.coupang.mobile"  // 쿠팡

        // 지원하는 패키지 목록 (결제 파싱용)
        private val SUPPORTED_PACKAGES = setOf(
            KB_PAY_PACKAGE,
            KB_CARD_PACKAGE,
            HWASEONG_LOCAL_CURRENCY,
            CHAK_WALLET,
            GYEONGGI_LOCAL_CURRENCY
        )

        // 알림 수집 대상 패키지 (분석용)
        private val NOTIFICATION_COLLECT_PACKAGES = setOf(
            COUPANG_EATS,
            COUPANG
        )

        // 알림 감지 브로드캐스트 액션
        const val ACTION_NOTIFICATION_RECEIVED = "com.household.account.NOTIFICATION_RECEIVED"
        const val EXTRA_EXPENSE_JSON = "expense_json"
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val expenseRepository = ExpenseRepository()
    private val ruleRepository = MerchantRuleRepository()
    private val rawNotificationRepository = RawNotificationRepository()

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return

        val packageName = sbn.packageName

        // 알림 수집 대상인지 확인 (분석용)
        if (packageName in NOTIFICATION_COLLECT_PACKAGES) {
            collectNotificationForAnalysis(sbn)
            return
        }

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

            // 전체 알림 텍스트 조합
            val fullText = if (bigText.isNotEmpty()) bigText else "$title\n$text"

            Log.d(TAG, "알림 내용: $fullText")

            // 앱 종류에 따라 파서 선택
            val result: ParseResult = when (packageName) {
                KB_PAY_PACKAGE, KB_CARD_PACKAGE -> KBCardParser.parse(fullText)
                HWASEONG_LOCAL_CURRENCY, CHAK_WALLET, GYEONGGI_LOCAL_CURRENCY -> LocalCurrencyParser.parse(fullText)
                else -> ParseResult(false, errorMessage = "지원하지 않는 앱")
            }

            if (result.success && result.expense != null) {
                Log.d(TAG, "파싱 성공: ${result.expense}")

                // 저장된 규칙으로 카테고리 찾기
                serviceScope.launch {
                    try {
                        val category = ruleRepository.findCategoryForMerchant(result.expense.merchant)

                        val expenseToSave = if (category != null) {
                            result.expense.copy(category = category.name)
                        } else {
                            // 규칙이 없으면 기타로 저장
                            result.expense.copy(category = Category.ETC.name)
                        }

                        val docId = expenseRepository.addExpense(expenseToSave)
                        Log.d(TAG, "Firebase 저장 완료 - 카테고리: ${expenseToSave.category}, ID: $docId")

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
     * 빠른 편집 화면 바로 띄우기
     */
    private fun launchQuickEditActivity(expense: Expense) {
        try {
            val intent = Intent(this, QuickEditActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
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

    /**
     * 알림을 DB에 저장 (분석용)
     */
    private fun collectNotificationForAnalysis(sbn: StatusBarNotification) {
        try {
            val packageName = sbn.packageName
            val notification = sbn.notification
            val extras = notification.extras

            val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
            val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
            val fullText = if (bigText.isNotEmpty()) bigText else "$title\n$text"

            Log.d(TAG, "알림 수집 [$packageName]: $fullText")

            serviceScope.launch {
                try {
                    val docId = rawNotificationRepository.saveNotification(
                        packageName = packageName,
                        title = title,
                        text = text,
                        bigText = bigText,
                        fullText = fullText
                    )
                    Log.d(TAG, "알림 저장 완료: $docId")
                } catch (e: Exception) {
                    Log.e(TAG, "알림 저장 실패", e)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "알림 수집 중 오류", e)
        }
    }
}
