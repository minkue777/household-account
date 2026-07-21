package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.util.CardLabelFormatter
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

object PayboocISPParser {

    private val cardInfoPattern = Regex("""(.+?)\(([0-9*xX]{4})\)\s*$""")
    private val separatedAmountEventPattern = Regex("""([\d,]+)원\s*(사용|취소)""")
    private val inlineApprovalPattern = Regex("""^(.+?)\s*에서\s*([\d,]+)원\s*사용(?:\s|$).*""")
    private val inlineCancellationPattern = Regex("""^\[매출취소]\s*(.+?)\s*에서\s*([\d,]+)원(?:\([^)]*\))?.*""")

    fun matches(notificationText: String): Boolean {
        val lines = normalizeLines(notificationText)
        return extractCardInfo(lines) != null && extractPaymentEvent(lines) != null
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null,
        clockNowMillis: Long? = null
    ): ParseResult {
        return try {
            val lines = normalizeLines(notificationText)
            val cardInfo = extractCardInfo(lines)
                ?: return ParseResult(false, errorMessage = "Card number not found")
            val paymentEvent = extractPaymentEvent(lines)
                ?: return ParseResult(false, errorMessage = "Paybooc payment format not found")
            val occurredAt = resolveDateTime(postedAtMillis, clockNowMillis)

            ParseResult(
                success = true,
                expense = Expense(
                    date = occurredAt.format(DateTimeFormatter.ISO_LOCAL_DATE),
                    time = occurredAt.format(DateTimeFormatter.ofPattern("HH:mm")),
                    merchant = paymentEvent.merchant,
                    amount = paymentEvent.amount,
                    category = Category.ETC.name,
                    cardType = CardType.MAIN.key,
                    cardLastFour = CardLabelFormatter.formatCardLabel(cardInfo.label, cardInfo.lastFour)
                ),
                eventType = paymentEvent.eventType
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Paybooc parse failed: ${e.message}")
        }
    }

    private fun normalizeLines(value: String): List<String> {
        return value
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
    }

    private fun extractMerchantLine(lines: List<String>): String? {
        return lines.firstOrNull { line ->
            line.endsWith("에서") &&
                !cardInfoPattern.containsMatchIn(line) &&
                !separatedAmountEventPattern.containsMatchIn(line) &&
                !line.contains("누적금액")
        }
    }

    private fun extractCardInfo(lines: List<String>): CardInfo? {
        val titleLine = lines.firstOrNull { cardInfoPattern.containsMatchIn(it) }
            ?: return null
        val match = cardInfoPattern.find(titleLine) ?: return null

        return CardInfo(
            label = normalizeCardLabel(match.groupValues[1]),
            lastFour = match.groupValues[2]
        )
    }

    private fun extractPaymentEvent(lines: List<String>): PaymentEvent? {
        lines.firstNotNullOfOrNull { line ->
            inlineCancellationPattern.matchEntire(line)?.let { match ->
                createPaymentEvent(
                    merchantValue = match.groupValues[1],
                    amountValue = match.groupValues[2],
                    eventType = ExpenseEventType.CANCELLATION
                )
            }
        }?.let { return it }

        lines.firstNotNullOfOrNull { line ->
            inlineApprovalPattern.matchEntire(line)?.let { match ->
                createPaymentEvent(
                    merchantValue = match.groupValues[1],
                    amountValue = match.groupValues[2],
                    eventType = ExpenseEventType.APPROVAL
                )
            }
        }?.let { return it }

        val amountLine = lines.firstOrNull { separatedAmountEventPattern.containsMatchIn(it) }
            ?: return null
        val amountMatch = separatedAmountEventPattern.find(amountLine) ?: return null
        val merchantLine = extractMerchantLine(lines) ?: return null

        return createPaymentEvent(
            merchantValue = merchantLine.removeSuffix("에서"),
            amountValue = amountMatch.groupValues[1],
            eventType = if (amountMatch.groupValues[2] == "취소") {
                ExpenseEventType.CANCELLATION
            } else {
                ExpenseEventType.APPROVAL
            }
        )
    }

    private fun createPaymentEvent(
        merchantValue: String,
        amountValue: String,
        eventType: ExpenseEventType
    ): PaymentEvent? {
        val merchant = merchantValue.trim()
        val amount = amountValue.replace(",", "").toIntOrNull() ?: return null

        if (merchant.isBlank() || amount <= 0) {
            return null
        }

        return PaymentEvent(
            merchant = merchant,
            amount = amount,
            eventType = eventType
        )
    }

    private fun normalizeCardLabel(value: String): String {
        val candidate = value
            .replace(Regex("""\([^)]*\)"""), " ")
            .trim()
            .split(Regex("""\s+"""))
            .lastOrNull()
            ?.trim()
            .orEmpty()

        return when {
            candidate.contains("농협") -> "농협"
            candidate.contains("비씨") || candidate.contains("BC", ignoreCase = true) -> "비씨"
            candidate.contains("국민") -> "국민"
            candidate.contains("우리") -> "우리"
            candidate.contains("하나") -> "하나"
            candidate.contains("신한") -> "신한"
            candidate.contains("삼성") -> "삼성"
            candidate.contains("현대") -> "현대"
            candidate.contains("롯데") -> "롯데"
            candidate.isNotBlank() -> candidate
            else -> "비씨"
        }
    }

    private fun resolveDateTime(postedAtMillis: Long?, clockNowMillis: Long?): LocalDateTime {
        return ParserTimeSupport.receivedAt(postedAtMillis, clockNowMillis)
    }

    private data class CardInfo(
        val label: String,
        val lastFour: String
    )

    private data class PaymentEvent(
        val merchant: String,
        val amount: Int,
        val eventType: ExpenseEventType
    )
}
