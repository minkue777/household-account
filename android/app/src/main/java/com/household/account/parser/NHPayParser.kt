package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.util.CardLabelFormatter
import java.time.LocalDate
import java.time.format.DateTimeFormatter

object NHPayParser {

    private val titlePattern = Regex("""NH농협\s*카드""")
    private val cardPattern = Regex("""NH카드([0-9*xX]{4})승인""")
    private val amountPattern = Regex("""([\d,]+)원""")
    private val dateTimePattern = Regex("""(\d{2}/\d{2})\s+(\d{2}:\d{2})""")

    fun matches(notificationText: String): Boolean {
        return titlePattern.containsMatchIn(notificationText) &&
            cardPattern.containsMatchIn(notificationText) &&
            amountPattern.containsMatchIn(notificationText) &&
            dateTimePattern.containsMatchIn(notificationText)
    }

    fun parse(
        notificationText: String,
        mainCardToken: String? = null
    ): ParseResult {
        return try {
            val cardMatch = cardPattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "NH card approval format not found")
            val cardToken = cardMatch.groupValues[1]

            val amountMatch = amountPattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "Amount not found")
            val amountValue = amountMatch.groupValues[1]

            val dateMatch = dateTimePattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "Date/time not found")
            val dateValue = dateMatch.groupValues[1]
            val timeValue = dateMatch.groupValues[2]

            val merchant = extractMerchant(notificationText, dateValue)
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
                    cardType = resolveCardType(cardToken, mainCardToken).key,
                    cardLastFour = CardLabelFormatter.formatCardLabel("농협", cardToken)
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "NH parse failed: ${e.message}")
        }
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
                    !candidate.matches(Regex("""^\d.*"""))
                ) {
                    return candidate
                }
            }
        }

        return "알수없음"
    }

    private fun resolveCardType(cardToken: String, mainCardToken: String?): CardType {
        if (mainCardToken.isNullOrBlank()) {
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
