package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object SmsCardMessageParser {

    private val nhSenderPattern = Regex("""^\[NH농협카드]$""")
    private val nhBillingPattern = Regex("""(\d{2})월분\s+(.+?)\s+([\d,]+)원""")
    private val nhCompletionPattern = Regex("""카드\s*정상\(승인\)납부\s*완료\.?""")

    fun matches(notificationText: String): Boolean {
        val lines = normalizeLines(notificationText)
        return matchesNhBilling(lines)
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null
    ): ParseResult {
        val lines = normalizeLines(notificationText)
        parseNhBilling(lines, postedAtMillis)?.let { return it }

        return ParseResult(false, errorMessage = "SMS card message format not supported")
    }

    private fun matchesNhBilling(lines: List<String>): Boolean {
        return lines.any { nhSenderPattern.matches(it) } &&
            lines.any { nhBillingPattern.containsMatchIn(it) } &&
            lines.any { nhCompletionPattern.containsMatchIn(it) }
    }

    private fun parseNhBilling(
        lines: List<String>,
        postedAtMillis: Long?
    ): ParseResult? {
        if (!matchesNhBilling(lines)) {
            return null
        }

        val amountLineIndex = lines.indexOfFirst { nhBillingPattern.containsMatchIn(it) }
        if (amountLineIndex < 0) {
            return null
        }

        val amountMatch = nhBillingPattern.find(lines[amountLineIndex]) ?: return null
        val billingLabel = "${amountMatch.groupValues[1]}월분 ${amountMatch.groupValues[2].trim()}"
        val amount = amountMatch.groupValues[3].replace(",", "").toIntOrNull() ?: return null

        val merchantLines = lines
            .take(amountLineIndex)
            .filterNot { it == "[Web발신]" || nhSenderPattern.matches(it) }

        val merchant = if (billingLabel.contains("관리비")) {
            billingLabel
        } else {
            merchantLines
                .plus(billingLabel)
                .joinToString(" ")
                .trim()
                .ifBlank { billingLabel }
        }
        val occurredAt = resolveDateTime(postedAtMillis)

        return ParseResult(
            success = true,
            expense = Expense(
                date = occurredAt.format(DateTimeFormatter.ISO_LOCAL_DATE),
                time = occurredAt.format(DateTimeFormatter.ofPattern("HH:mm")),
                merchant = merchant,
                amount = amount,
                category = Category.ETC.name,
                cardType = CardType.MAIN.key,
                cardLastFour = "농협"
            ),
            eventType = ExpenseEventType.APPROVAL
        )
    }

    private fun normalizeLines(value: String): List<String> {
        return value
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
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
