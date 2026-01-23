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
 * KB Pay 알림 파서
 *
 * 알림 형식 1 (간단):
 * [KB Pay 사용 알림] 신용 0027 01/23 13:05 51,000원
 * 라그로서리 승인
 *
 * 알림 형식 2 (상세):
 * KB국민카드0027승인
 * 이*규님
 * 3,680원 일시불
 * 01/23 16:43
 * 지에스더프레시
 * 누적2,008,994원
 */
object KBCardParser {

    // KB Pay 간단 알림 패턴
    // [KB Pay 사용 알림] 신용 {카드4자리} {MM/DD} {HH:mm} {금액}원
    private val KBPAY_SIMPLE_PATTERN = Regex(
        """\[KB Pay 사용 알림\]\s*신용\s*(\d{4})\s*(\d{2}/\d{2})\s*(\d{2}:\d{2})\s*([\d,]+)원"""
    )

    // KB Pay 상세 알림 패턴
    // KB국민카드{카드4자리}승인 ... {금액}원 일시불 ... {MM/DD} {HH:mm} ... {가맹점명}
    private val KBPAY_DETAIL_PATTERN = Regex(
        """KB국민카드(\d{4})승인"""
    )
    private val DETAIL_AMOUNT_PATTERN = Regex("""([\d,]+)원\s*일시불""")
    private val DETAIL_DATE_PATTERN = Regex("""(\d{2}/\d{2})\s+(\d{2}:\d{2})""")

    // 가맹점명 패턴 (두 번째 줄: {가맹점명} 승인)
    private val MERCHANT_PATTERN = Regex("""^(.+?)\s*승인\s*$""", RegexOption.MULTILINE)

    /**
     * 알림 텍스트 파싱
     *
     * @param notificationText 알림 전체 텍스트
     * @param mainCardLastFour 본인 카드 끝 4자리
     * @return ParseResult
     */
    fun parse(
        notificationText: String,
        mainCardLastFour: String = "0027"
    ): ParseResult {
        // 간단 형식 먼저 시도
        val simpleResult = parseSimpleFormat(notificationText, mainCardLastFour)
        if (simpleResult.success) {
            return simpleResult
        }

        // 상세 형식 시도
        val detailResult = parseDetailFormat(notificationText, mainCardLastFour)
        if (detailResult.success) {
            return detailResult
        }

        return ParseResult(false, errorMessage = "KB Pay 알림 형식이 아닙니다")
    }

    /**
     * 간단 형식 파싱
     * [KB Pay 사용 알림] 신용 0027 01/23 16:23 2,900원 반디소아청소년과 승인
     */
    private fun parseSimpleFormat(
        notificationText: String,
        mainCardLastFour: String
    ): ParseResult {
        try {
            val kbPayMatch = KBPAY_SIMPLE_PATTERN.find(notificationText)
                ?: return ParseResult(false, errorMessage = "간단 형식 아님")

            val (cardLast4, dateStr, timeStr, amountStr) = kbPayMatch.destructured

            // 가맹점명 추출 (금액 뒤 텍스트에서)
            val afterAmount = notificationText.substringAfter("${amountStr}원").trim()
            val merchant = afterAmount.replace("승인", "").trim().ifEmpty { "알 수 없음" }

            return createExpense(cardLast4, dateStr, timeStr, amountStr, merchant, mainCardLastFour)
        } catch (e: Exception) {
            return ParseResult(false, errorMessage = "간단 형식 파싱 오류: ${e.message}")
        }
    }

    /**
     * 상세 형식 파싱
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
            val cardMatch = KBPAY_DETAIL_PATTERN.find(notificationText)
                ?: return ParseResult(false, errorMessage = "상세 형식 아님")
            val cardLast4 = cardMatch.groupValues[1]

            // 금액 추출
            val amountMatch = DETAIL_AMOUNT_PATTERN.find(notificationText)
                ?: return ParseResult(false, errorMessage = "금액 없음")
            val amountStr = amountMatch.groupValues[1]

            // 날짜/시간 추출
            val dateMatch = DETAIL_DATE_PATTERN.find(notificationText)
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
            return ParseResult(false, errorMessage = "상세 형식 파싱 오류: ${e.message}")
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
                cardType = cardType.name,
                cardLastFour = cardLast4
            )

            return ParseResult(true, expense)
        } catch (e: Exception) {
            return ParseResult(false, errorMessage = "Expense 생성 오류: ${e.message}")
        }
    }
}
