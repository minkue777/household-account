package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.util.CardLabelFormatter
import java.time.LocalDate
import java.time.format.DateTimeFormatter

object NHPayParser {

    private val nhCardKeyword = Regex("""NH카드""")
    private val approvalPattern = Regex("""승인(취소)?""")
    private val cardSectionPattern = Regex("""NH카드\s*([^\n]*?)\s*승인""")
    private val cardTokenPattern = Regex("""[0-9xX*＊]{4}""")
    private val amountPattern = Regex("""([\d,]+)원""")
    private val dateTimePattern = Regex("""(\d{1,2}/\d{1,2})\s+(\d{2}:\d{2})""")

    fun matches(notificationText: String): Boolean {
        return nhCardKeyword.containsMatchIn(notificationText) &&
            approvalPattern.containsMatchIn(notificationText) &&
            extractPaymentAmount(notificationText) != null &&
            dateTimePattern.containsMatchIn(notificationText)
    }

    fun parse(
        notificationText: String,
        mainCardToken: String? = null
    ): ParseResult {
        return try {
            if (!nhCardKeyword.containsMatchIn(notificationText) ||
                !approvalPattern.containsMatchIn(notificationText)
            ) {
                return ParseResult(false, errorMessage = "NH card approval format not found")
            }

            val cardToken = extractCardToken(notificationText)
            val eventType = if (notificationText.contains("승인취소")) {
                ExpenseEventType.CANCELLATION
            } else {
                ExpenseEventType.APPROVAL
            }

            val amount = extractPaymentAmount(notificationText)
                ?: return ParseResult(false, errorMessage = "Amount not found")

            val dateMatch = dateTimePattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "Date/time not found")
            val dateValue = dateMatch.groupValues[1]
            val timeValue = dateMatch.groupValues[2]

            val merchant = extractMerchant(notificationText, dateValue)

            ParseResult(
                success = true,
                expense = Expense(
                    date = resolveDate(dateValue),
                    time = timeValue,
                    merchant = merchant,
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = resolveCardType(cardToken, mainCardToken).key,
                    cardLastFour = CardLabelFormatter.formatCardLabel("농협", cardToken)
                ),
                eventType = eventType
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "NH parse failed: ${e.message}")
        }
    }

    private fun extractCardToken(notificationText: String): String? {
        val rawSection = cardSectionPattern.find(notificationText)?.groupValues?.get(1).orEmpty()
        if (rawSection.isBlank()) {
            return null
        }

        val normalizedSection = rawSection.replace(Regex("""\s+"""), "")
        val token = cardTokenPattern.find(normalizedSection)?.value ?: return null

        return token
            .replace('＊', '*')
            .replace('X', 'x')
    }

    private fun extractPaymentAmount(notificationText: String): Int? {
        val lines = notificationText
            .split("\n")
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        for (line in lines) {
            if (line.startsWith("잔액") ||
                line.startsWith("총누적") ||
                line.startsWith("총 사용")
            ) {
                continue
            }

            val match = amountPattern.find(line) ?: continue
            return match.groupValues[1].replace(",", "").toIntOrNull()
        }

        return null
    }

    private fun extractMerchant(notificationText: String, dateValue: String): String {
        val lines = notificationText
            .split("\n")
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        for (index in lines.indices) {
            if (lines[index].contains(dateValue) && index + 1 < lines.size) {
                val candidate = lines[index + 1]
                if (!candidate.startsWith("잔액") &&
                    !candidate.startsWith("총누적") &&
                    !candidate.startsWith("총 사용") &&
                    !amountPattern.containsMatchIn(candidate)
                ) {
                    return candidate
                }
            }
        }

        return "알수없음"
    }

    private fun resolveCardType(cardToken: String?, mainCardToken: String?): CardType {
        if (cardToken.isNullOrBlank() || mainCardToken.isNullOrBlank()) {
            return CardType.MAIN
        }

        return if (cardToken == mainCardToken) {
            CardType.MAIN
        } else {
            CardType.FAMILY
        }
    }

    private fun resolveDate(dateValue: String): String {
        val currentYear = LocalDate.now().year
        val (month, day) = dateValue.split("/").map { it.toInt() }
        val date = LocalDate.of(currentYear, month, day)
        return date.format(DateTimeFormatter.ISO_LOCAL_DATE)
    }
}
