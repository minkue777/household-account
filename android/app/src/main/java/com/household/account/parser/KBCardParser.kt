package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * KB카드 알림 파싱 결과
 */
data class ParseResult(
    val success: Boolean,
    val expense: Expense? = null,
    val errorMessage: String? = null
)

/**
 * KB 국민카드 알림 파서
 *
 * 처리하는 형식 (KB국민카드 앱):
 * KB국민카드0027승인
 * 이*규님
 * 3,680원 일시불
 * 01/23 16:43
 * 지에스더프레시
 * 누적2,008,994원
 *
 * [KB Pay 사용 알림] 형식은 중복이므로 무시됨 (패턴 불일치로 자동 제외)
 */
object KBCardParser {

    // KB국민카드 승인 알림 패턴
    private val KB_CARD_PATTERN = Regex("""KB국민카드(\d{4})승인""")
    private val AMOUNT_PATTERN = Regex("""([\d,]+)원\s*일시불""")
    private val DATE_TIME_PATTERN = Regex("""(\d{2}/\d{2})\s+(\d{2}:\d{2})""")

    /**
     * 알림 텍스트 파싱
     *
     * KB국민카드xxxx승인 형식만 처리 (중복 방지)
     * [KB Pay 사용 알림] 형식은 패턴 불일치로 자동 무시됨
     *
     * @param notificationText 알림 전체 텍스트
     * @param mainCardLastFour 본인 카드 끝 4자리
     * @return ParseResult
     */
    fun parse(
        notificationText: String,
        mainCardLastFour: String = "0027"
    ): ParseResult {
        // KB국민카드xxxx승인 형식만 매칭
        return parseDetailFormat(notificationText, mainCardLastFour)
    }

    /**
     * KB국민카드 승인 알림 파싱
     * KB국민카드0027승인
     * 이*규님
     * 3,680원 일시불
     * 01/23 16:43
     * 지에스더프레시
     */
    private fun parseDetailFormat(
        notificationText: String,
        mainCardLastFour: String
    ): ParseResult {
        try {
            // 카드번호 추출
            val cardMatch = KB_CARD_PATTERN.find(notificationText)
                ?: return ParseResult(false, errorMessage = "KB국민카드 승인 형식 아님")
            val cardLast4 = cardMatch.groupValues[1]

            // 금액 추출
            val amountMatch = AMOUNT_PATTERN.find(notificationText)
                ?: return ParseResult(false, errorMessage = "금액 없음")
            val amountStr = amountMatch.groupValues[1]

            // 날짜/시간 추출
            val dateMatch = DATE_TIME_PATTERN.find(notificationText)
                ?: return ParseResult(false, errorMessage = "날짜 없음")
            val dateStr = dateMatch.groupValues[1]
            val timeStr = dateMatch.groupValues[2]

            // 가맹점명 추출 (날짜/시간 다음 줄)
            val lines = notificationText.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
            var merchant = "알 수 없음"

            // 날짜 다음 줄이 가맹점명
            for (i in lines.indices) {
                if (lines[i].contains(dateStr) && i + 1 < lines.size) {
                    val nextLine = lines[i + 1]
                    // "누적" 또는 숫자로 시작하면 건너뜀
                    if (!nextLine.startsWith("누적") && !nextLine.matches(Regex("^\\d.*"))) {
                        merchant = nextLine
                        break
                    }
                }
            }

            return createExpense(cardLast4, dateStr, timeStr, amountStr, merchant, mainCardLastFour)
        } catch (e: Exception) {
            return ParseResult(false, errorMessage = "파싱 오류: ${e.message}")
        }
    }

    /**
     * Expense 객체 생성
     */
    private fun createExpense(
        cardLast4: String,
        dateStr: String,
        timeStr: String,
        amountStr: String,
        merchant: String,
        mainCardLastFour: String
    ): ParseResult {
        try {
            // 금액 파싱 (콤마 제거)
            val amount = amountStr.replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "금액 파싱 실패: $amountStr")

            // 날짜 파싱 (MM/DD -> YYYY-MM-DD)
            val currentYear = LocalDate.now().year
            val (month, day) = dateStr.split("/").map { it.toInt() }
            val date = LocalDate.of(currentYear, month, day)
            val formattedDate = date.format(DateTimeFormatter.ISO_LOCAL_DATE)

            // 카드 타입 결정 (본인 카드 vs 가족 카드)
            val cardType = if (cardLast4 == mainCardLastFour) {
                CardType.MAIN
            } else {
                CardType.FAMILY
            }

            val expense = Expense(
                date = formattedDate,
                time = timeStr,
                merchant = merchant,
                amount = amount,
                category = Category.ETC.name,
                cardType = cardType.key,  // 소문자로 저장
                cardLastFour = cardLast4
            )

            return ParseResult(true, expense)
        } catch (e: Exception) {
            return ParseResult(false, errorMessage = "Expense 생성 오류: ${e.message}")
        }
    }
}
