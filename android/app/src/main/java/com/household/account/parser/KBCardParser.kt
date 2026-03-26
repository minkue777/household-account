package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.util.CardLabelFormatter
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class ParseResult(
    val success: Boolean,
    val expense: Expense? = null,
    val errorMessage: String? = null,
    val eventType: ExpenseEventType = ExpenseEventType.APPROVAL
)

enum class ExpenseEventType {
    APPROVAL,
    CANCELLATION
}

object KBCardParser {

    private val cardPattern = Regex("""KB국민카드(\d{4})\s*(승인|취소)""")
    private val detailAmountPattern = Regex("""([\d,]+)원\s*(?:일시불|할부)?""")
    private val dateTimePattern = Regex("""(\d{2}/\d{2})\s+(\d{2}:\d{2})""")
    private val summaryAmountDatePattern = Regex("""([\d,]+)원\s+(\d{2}/\d{2})(?:\s+(\d{2}:\d{2}))?""")

    fun matches(notificationText: String): Boolean {
        return cardPattern.containsMatchIn(notificationText) &&
            (
                dateTimePattern.containsMatchIn(notificationText) ||
                    summaryAmountDatePattern.containsMatchIn(notificationText)
                )
    }

    fun parse(
        notificationText: String,
        mainCardLastFour: String? = null,
        postedAtMillis: Long? = null
    ): ParseResult {
        parseDetailFormat(notificationText, mainCardLastFour)?.let { return it }
        parseSummaryFormat(notificationText, mainCardLastFour, postedAtMillis)?.let { return it }
        return ParseResult(false, errorMessage = "KB card format not found")
    }

    private fun parseDetailFormat(
        notificationText: String,
        mainCardLastFour: String?
    ): ParseResult? {
        return try {
            val cardMatch = cardPattern.find(notificationText) ?: return null
            val dateMatch = dateTimePattern.find(notificationText) ?: return null
            val amountMatch = detailAmountPattern.find(notificationText) ?: return null

            createExpense(
                cardLastFour = cardMatch.groupValues[1],
                dateValue = dateMatch.groupValues[1],
                timeValue = dateMatch.groupValues[2],
                amountValue = amountMatch.groupValues[1],
                merchant = extractMerchantAfterLine(notificationText, dateMatch.value),
                mainCardLastFour = mainCardLastFour,
                eventType = resolveEventType(cardMatch.groupValues[2])
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "KB detail parse failed: ${e.message}")
        }
    }

    private fun parseSummaryFormat(
        notificationText: String,
        mainCardLastFour: String?,
        postedAtMillis: Long?
    ): ParseResult? {
        return try {
            val cardMatch = cardPattern.find(notificationText) ?: return null
            val lines = notificationText
                .lines()
                .map { it.trim() }
                .filter { it.isNotEmpty() }

            val amountDateIndex = lines.indexOfFirst { summaryAmountDatePattern.containsMatchIn(it) }
            if (amountDateIndex < 0) {
                return null
            }

            val amountDateMatch = summaryAmountDatePattern.find(lines[amountDateIndex]) ?: return null
            val merchant = extractMerchantFromNextLines(lines, amountDateIndex + 1)

            createExpense(
                cardLastFour = cardMatch.groupValues[1],
                dateValue = amountDateMatch.groupValues[2],
                timeValue = amountDateMatch.groupValues[3].ifBlank {
                    resolvePostedTime(postedAtMillis)
                },
                amountValue = amountDateMatch.groupValues[1],
                merchant = merchant,
                mainCardLastFour = mainCardLastFour,
                eventType = resolveEventType(cardMatch.groupValues[2])
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "KB summary parse failed: ${e.message}")
        }
    }

    private fun extractMerchantAfterLine(notificationText: String, marker: String): String {
        val lines = notificationText
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        val markerIndex = lines.indexOfFirst { it.contains(marker) }
        if (markerIndex < 0) {
            return "알수없음"
        }

        return extractMerchantFromNextLines(lines, markerIndex + 1)
    }

    private fun extractMerchantFromNextLines(lines: List<String>, startIndex: Int): String {
        for (index in startIndex until lines.size) {
            val normalized = normalizeMerchant(lines[index])
            if (normalized != null) {
                return normalized
            }
        }

        return "알수없음"
    }

    private fun normalizeMerchant(value: String): String? {
        val normalized = value
            .replace(Regex("""\s*(승인|취소)\s*$"""), "")
            .trim()

        if (normalized.isBlank()) return null
        if (normalized.startsWith("누적")) return null
        if (normalized.matches(Regex("""^[\d,\s/:원]+$"""))) return null
        if (normalized.matches(Regex("""^(신용|체크)\s+\d{4}.*$"""))) return null

        return normalized
    }

    private fun createExpense(
        cardLastFour: String,
        dateValue: String,
        timeValue: String,
        amountValue: String,
        merchant: String,
        mainCardLastFour: String?,
        eventType: ExpenseEventType = ExpenseEventType.APPROVAL
    ): ParseResult {
        return try {
            val amount = amountValue.replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount: $amountValue")

            ParseResult(
                success = true,
                expense = Expense(
                    date = resolveDate(dateValue),
                    time = timeValue,
                    merchant = merchant,
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = resolveCardType(cardLastFour, mainCardLastFour).key,
                    cardLastFour = CardLabelFormatter.formatCardLabel("국민", cardLastFour)
                ),
                eventType = eventType
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Expense creation failed: ${e.message}")
        }
    }

    private fun resolveEventType(value: String): ExpenseEventType {
        return if (value == "취소") {
            ExpenseEventType.CANCELLATION
        } else {
            ExpenseEventType.APPROVAL
        }
    }

    private fun resolveCardType(
        cardLastFour: String,
        mainCardLastFour: String?
    ): CardType {
        if (mainCardLastFour.isNullOrBlank()) {
            return CardType.MAIN
        }

        return if (cardLastFour == mainCardLastFour) {
            CardType.MAIN
        } else {
            CardType.FAMILY
        }
    }

    private fun resolveDate(dateValue: String): String {
        val currentYear = LocalDate.now().year
        val (month, day) = dateValue.split("/").map { it.toInt() }
        return LocalDate.of(currentYear, month, day).format(DateTimeFormatter.ISO_LOCAL_DATE)
    }

    private fun resolvePostedTime(postedAtMillis: Long?): String {
        if (postedAtMillis == null || postedAtMillis <= 0L) {
            return "00:00"
        }

        return Instant.ofEpochMilli(postedAtMillis)
            .atZone(ZoneId.systemDefault())
            .toLocalTime()
            .format(DateTimeFormatter.ofPattern("HH:mm"))
    }
}
