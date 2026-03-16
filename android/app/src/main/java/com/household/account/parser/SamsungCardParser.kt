package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.LocalDate
import java.time.format.DateTimeFormatter

object SamsungCardParser {

    private val cardPattern = Regex("""삼성([0-9*]{4})\s*(승인|취소)""")
    private val amountPattern = Regex("""([\d,]+)원\s*(일시불|할부)?""")
    private val dateTimeMerchantPattern = Regex("""(\d{2}/\d{2})\s+(\d{2}:\d{2})\s+(.+)""")

    fun matches(notificationText: String): Boolean {
        return cardPattern.containsMatchIn(notificationText) &&
            amountPattern.containsMatchIn(notificationText) &&
            dateTimeMerchantPattern.containsMatchIn(notificationText)
    }

    fun parse(
        notificationText: String,
        mainCardToken: String? = null
    ): ParseResult {
        return try {
            val cardMatch = cardPattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "Samsung card format not found")
            val amountMatch = amountPattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "Amount not found")
            val dateTimeMatch = dateTimeMerchantPattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "Date/time not found")

            val cardToken = cardMatch.groupValues[1]
            val eventType = if (cardMatch.groupValues[2] == "취소") {
                ExpenseEventType.CANCELLATION
            } else {
                ExpenseEventType.APPROVAL
            }
            val amount = amountMatch.groupValues[1].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")

            ParseResult(
                success = true,
                expense = Expense(
                    date = resolveDate(dateTimeMatch.groupValues[1]),
                    time = dateTimeMatch.groupValues[2],
                    merchant = dateTimeMatch.groupValues[3].trim(),
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = resolveCardType(cardToken, mainCardToken).key,
                    cardLastFour = cardToken
                ),
                eventType = eventType
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Samsung parse failed: ${e.message}")
        }
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
