package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.LocalDate
import java.time.format.DateTimeFormatter

data class ParseResult(
    val success: Boolean,
    val expense: Expense? = null,
    val errorMessage: String? = null
)

object KBCardParser {

    private val kbCardPattern = Regex("""KB국민카드(\d{4})승인""")
    private val amountPattern = Regex("""([\d,]+)원\s*일시불""")
    private val dateTimePattern = Regex("""(\d{2}/\d{2})\s+(\d{2}:\d{2})""")

    fun matches(notificationText: String): Boolean {
        return kbCardPattern.containsMatchIn(notificationText) &&
            amountPattern.containsMatchIn(notificationText) &&
            dateTimePattern.containsMatchIn(notificationText)
    }

    fun parse(
        notificationText: String,
        mainCardLastFour: String? = null
    ): ParseResult {
        return parseDetailFormat(notificationText, mainCardLastFour)
    }

    private fun parseDetailFormat(
        notificationText: String,
        mainCardLastFour: String?
    ): ParseResult {
        return try {
            val cardMatch = kbCardPattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "KB card approval format not found")
            val cardLastFour = cardMatch.groupValues[1]

            val amountMatch = amountPattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "Amount not found")
            val amountValue = amountMatch.groupValues[1]

            val dateMatch = dateTimePattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "Date/time not found")
            val dateValue = dateMatch.groupValues[1]
            val timeValue = dateMatch.groupValues[2]

            val merchant = extractMerchant(notificationText, dateValue)

            createExpense(
                cardLastFour = cardLastFour,
                dateValue = dateValue,
                timeValue = timeValue,
                amountValue = amountValue,
                merchant = merchant,
                mainCardLastFour = mainCardLastFour
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "KB parse failed: ${e.message}")
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
                if (!candidate.startsWith("누적") && !candidate.matches(Regex("""^\d.*"""))) {
                    return candidate
                }
            }
        }

        return "알수없음"
    }

    private fun createExpense(
        cardLastFour: String,
        dateValue: String,
        timeValue: String,
        amountValue: String,
        merchant: String,
        mainCardLastFour: String?
    ): ParseResult {
        return try {
            val amount = amountValue.replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount: $amountValue")

            val formattedDate = resolveDate(dateValue)
            val cardType = resolveCardType(cardLastFour, mainCardLastFour)

            ParseResult(
                success = true,
                expense = Expense(
                    date = formattedDate,
                    time = timeValue,
                    merchant = merchant,
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = cardType.key,
                    cardLastFour = cardLastFour
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Expense creation failed: ${e.message}")
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
        val date = LocalDate.of(currentYear, month, day)
        return date.format(DateTimeFormatter.ISO_LOCAL_DATE)
    }
}
