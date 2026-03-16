package com.household.account.parser

import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

data class LocalCurrencyBalanceResult(
    val balance: Int?,
    val currencyType: String? = null
)

internal object LocalCurrencyParsingSupport {

    val balancePatterns = listOf(
        Regex("""잔액\s*([\d,]+)원"""),
        Regex("""총\s*보유\s*잔액\s*\n?\s*([\d,]+)원"""),
        Regex("""보유\s*잔액\s*[:\s]*([\d,]+)원""")
    )

    val paymentPatterns = listOf(
        Regex("""결제\s*완료\s*([\d,]+)원"""),
        Regex("""결제\s*([\d,]+)원"""),
        Regex("""승인\s*([\d,]+)원"""),
        Regex("""사용\s*완료?\s*([\d,]+)원"""),
        Regex("""([\d,]+)원\s*결제"""),
        Regex("""([\d,]+)원\s*승인""")
    )

    fun normalizeInline(value: String): String {
        return value
            .lines()
            .joinToString(" ") { it.trim() }
            .replace(Regex("""\s+"""), " ")
            .trim()
    }

    fun splitLines(value: String): List<String> {
        return value
            .split("\n")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
    }

    fun extractDateTime(notificationText: String, dateTimePattern: Regex): Pair<String, String> {
        val match = dateTimePattern.find(notificationText)
        if (match != null) {
            return resolveDate(match.groupValues[1]) to match.groupValues[2]
        }

        val today = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE)
        val now = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"))
        return today to now
    }

    fun resolveDate(dateValue: String): String {
        val currentYear = LocalDate.now().year
        val (month, day) = dateValue.split("/").map { it.toInt() }
        val date = LocalDate.of(currentYear, month, day)
        return date.format(DateTimeFormatter.ISO_LOCAL_DATE)
    }
}
