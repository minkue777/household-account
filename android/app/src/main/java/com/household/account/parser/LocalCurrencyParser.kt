package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * 지역화폐 알림 파서
 *
 * 화성지역화폐 알림 형식:
 * 결제 완료 2,300원
 * 도도약국
 * 희망화성지역화폐 인센티브 209원
 * 희망화성지역화폐_특례시기념 총 보유 잔액
 * 65,794원
 */
object LocalCurrencyParser {

    // 결제 완료 패턴
    private val PAYMENT_PATTERN = Regex("""결제\s*완료\s*([\d,]+)원""")

    /**
     * 화성지역화폐 알림 파싱
     */
    fun parse(notificationText: String): ParseResult {
        try {
            // 결제 완료 패턴 매칭
            val paymentMatch = PAYMENT_PATTERN.find(notificationText)
                ?: return ParseResult(false, errorMessage = "지역화폐 알림 형식이 아닙니다")

            val amountStr = paymentMatch.groupValues[1]

            // 금액 파싱
            val amount = amountStr.replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "금액 파싱 실패: $amountStr")

            // 가맹점명 추출 (결제 완료 다음 줄)
            val lines = notificationText.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
            var merchant = "알 수 없음"

            for (i in lines.indices) {
                if (lines[i].contains("결제") && lines[i].contains("완료")) {
                    if (i + 1 < lines.size) {
                        val nextLine = lines[i + 1]
                        // 인센티브나 잔액 관련 줄은 건너뜀
                        if (!nextLine.contains("인센티브") &&
                            !nextLine.contains("잔액") &&
                            !nextLine.matches(Regex("^[\\d,]+원$"))) {
                            merchant = nextLine
                            break
                        }
                    }
                }
            }

            // 오늘 날짜와 현재 시간 사용 (알림에 날짜/시간이 없음)
            val today = LocalDate.now()
            val now = LocalTime.now()
            val formattedDate = today.format(DateTimeFormatter.ISO_LOCAL_DATE)
            val formattedTime = now.format(DateTimeFormatter.ofPattern("HH:mm"))

            val expense = Expense(
                date = formattedDate,
                time = formattedTime,
                merchant = merchant,
                amount = amount,
                category = Category.ETC.name,
                cardType = CardType.MAIN.name,  // 지역화폐는 본인 사용으로 처리
                cardLastFour = "지역"  // 지역화폐 표시
            )

            return ParseResult(true, expense)

        } catch (e: Exception) {
            return ParseResult(false, errorMessage = "파싱 오류: ${e.message}")
        }
    }
}
