package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.util.CardLabelFormatter
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object PayboocISPParser {

    private val cardLastFourPattern = Regex("""\(([0-9*xX]{4})\)\s*$""")
    private val amountEventPattern = Regex("""([\d,]+)원\s*(사용|취소)""")

    fun matches(notificationText: String): Boolean {
        val lines = normalizeLines(notificationText)
        return lines.any { cardLastFourPattern.containsMatchIn(it) } &&
            lines.any { amountEventPattern.containsMatchIn(it) } &&
            extractMerchantLine(lines) != null
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null
    ): ParseResult {
        return try {
            val lines = normalizeLines(notificationText)
            val titleLine = lines.firstOrNull { cardLastFourPattern.containsMatchIn(it) }
                ?: return ParseResult(false, errorMessage = "Paybooc title format not found")
            val amountLine = lines.firstOrNull { amountEventPattern.containsMatchIn(it) }
                ?: return ParseResult(false, errorMessage = "Paybooc amount format not found")
            val merchantLine = extractMerchantLine(lines)
                ?: return ParseResult(false, errorMessage = "Paybooc merchant format not found")

            val cardMatch = cardLastFourPattern.find(titleLine)
                ?: return ParseResult(false, errorMessage = "Card number not found")
            val amountMatch = amountEventPattern.find(amountLine)
                ?: return ParseResult(false, errorMessage = "Amount/event not found")
            val amount = amountMatch.groupValues[1].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")
            val eventType = if (amountMatch.groupValues[2] == "취소") {
                ExpenseEventType.CANCELLATION
            } else {
                ExpenseEventType.APPROVAL
            }
            val occurredAt = resolveDateTime(postedAtMillis)

            ParseResult(
                success = true,
                expense = Expense(
                    date = occurredAt.format(DateTimeFormatter.ISO_LOCAL_DATE),
                    time = occurredAt.format(DateTimeFormatter.ofPattern("HH:mm")),
                    merchant = merchantLine.removeSuffix("에서").trim(),
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = CardType.MAIN.key,
                    cardLastFour = CardLabelFormatter.formatCardLabel("비씨", cardMatch.groupValues[1])
                ),
                eventType = eventType
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
                !cardLastFourPattern.containsMatchIn(line) &&
                !amountEventPattern.containsMatchIn(line) &&
                !line.contains("누적금액")
        }
    }

    private fun resolveDateTime(postedAtMillis: Long?): LocalDateTime {
        return if (postedAtMillis != null && postedAtMillis > 0L) {
            Instant.ofEpochMilli(postedAtMillis)
                .atZone(ZoneId.systemDefault())
                .toLocalDateTime()
        } else {
            LocalDateTime.now()
        }
    }
}
