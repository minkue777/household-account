package com.household.account.parser

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

    fun extractDateTime(
        notificationText: String,
        dateTimePattern: Regex,
        postedAtMillis: Long? = null,
        clockNowMillis: Long? = null
    ): Pair<String, String> {
        val match = dateTimePattern.find(notificationText)
        if (match != null) {
            val occurrence = ParserTimeSupport.resolveOccurrence(
                match.groupValues[1],
                match.groupValues[2],
                postedAtMillis,
                clockNowMillis
            )
            return occurrence.date to occurrence.time
        }

        val receivedAt = ParserTimeSupport.receivedAt(postedAtMillis, clockNowMillis)
        val time = receivedAt.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm"))
        return receivedAt.toLocalDate().toString() to time
    }

    fun resolveDate(
        dateValue: String,
        timeValue: String,
        postedAtMillis: Long? = null,
        clockNowMillis: Long? = null
    ): String {
        return ParserTimeSupport.resolveOccurrence(
            dateValue,
            timeValue,
            postedAtMillis,
            clockNowMillis
        ).date
    }
}
