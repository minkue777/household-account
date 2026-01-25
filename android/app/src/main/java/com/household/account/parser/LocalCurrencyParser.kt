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
 *
 * 경기지역화폐 알림 형식 (여러 형태 지원):
 * - 결제 2,300원
 * - 승인 2,300원
 * - 결제완료 2,300원
 * - 사용완료 2,300원
 */
object LocalCurrencyParser {

    // 다양한 결제 패턴 지원
    private val PAYMENT_PATTERNS = listOf(
        Regex("""결제\s*완료\s*([\d,]+)원"""),
        Regex("""결제\s*([\d,]+)원"""),
        Regex("""승인\s*([\d,]+)원"""),
        Regex("""사용\s*완료?\s*([\d,]+)원"""),
        Regex("""([\d,]+)원\s*결제"""),
        Regex("""([\d,]+)원\s*승인""")
    )

    /**
     * 지역화폐 알림 파싱 (화성, 경기 등 다양한 형식 지원)
     */
    fun parse(notificationText: String): ParseResult {
        try {
            // 여러 패턴으로 결제 정보 찾기
            var paymentMatch: MatchResult? = null
            for (pattern in PAYMENT_PATTERNS) {
                paymentMatch = pattern.find(notificationText)
                if (paymentMatch != null) break
            }

            if (paymentMatch == null) {
                return ParseResult(false, errorMessage = "지역화폐 알림 형식이 아닙니다: $notificationText")
            }

            val amountStr = paymentMatch.groupValues[1]

            // 금액 파싱
            val amount = amountStr.replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "금액 파싱 실패: $amountStr")

            // 가맹점명 추출 (여러 방법 시도)
            val lines = notificationText.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
            var merchant = "알 수 없음"

            // 방법 1: 결제/승인 다음 줄에서 가맹점명 찾기
            for (i in lines.indices) {
                val line = lines[i]
                if (line.contains("결제") || line.contains("승인") || line.contains("사용")) {
                    if (i + 1 < lines.size) {
                        val nextLine = lines[i + 1]
                        // 인센티브, 잔액, 금액 관련 줄은 건너뜀
                        if (!nextLine.contains("인센티브") &&
                            !nextLine.contains("잔액") &&
                            !nextLine.contains("포인트") &&
                            !nextLine.contains("캐시백") &&
                            !nextLine.matches(Regex("^[\\d,]+원$"))) {
                            merchant = nextLine
                            break
                        }
                    }
                }
            }

            // 방법 2: 가맹점 패턴으로 찾기 (가맹점: XXX 형식)
            if (merchant == "알 수 없음") {
                val merchantPattern = Regex("""가맹점[:\s]*(.+)""")
                val merchantMatch = merchantPattern.find(notificationText)
                if (merchantMatch != null) {
                    merchant = merchantMatch.groupValues[1].trim()
                }
            }

            // 방법 3: 금액이 아닌 첫 번째 줄을 가맹점으로 사용
            if (merchant == "알 수 없음") {
                for (line in lines) {
                    if (!line.contains("원") &&
                        !line.contains("결제") &&
                        !line.contains("승인") &&
                        !line.contains("사용") &&
                        !line.contains("잔액") &&
                        !line.contains("인센티브") &&
                        !line.contains("지역화폐") &&
                        !line.contains("포인트") &&
                        line.length in 2..30) {
                        merchant = line
                        break
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
