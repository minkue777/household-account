package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.util.CardLabelFormatter

object SamsungCardParser {

    private val cardPattern = Regex("""삼성([0-9*xX]{4})\s*(승인|취소)""")
    private val amountPattern = Regex("""([\d,]+)원\s*(일시불|할부)?""")
    private val dateTimeMerchantPattern = Regex("""(\d{2}/\d{2})\s+(\d{2}:\d{2})\s+(.+)""")

    fun matches(notificationText: String): Boolean {
        return cardPattern.containsMatchIn(notificationText) &&
            amountPattern.containsMatchIn(notificationText) &&
            dateTimeMerchantPattern.containsMatchIn(notificationText)
    }

    fun parse(
        notificationText: String,
        mainCardToken: String? = null,
        postedAtMillis: Long? = null,
        clockNowMillis: Long? = null
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
            val occurrence = ParserTimeSupport.resolveOccurrence(
                dateTimeMatch.groupValues[1],
                dateTimeMatch.groupValues[2],
                postedAtMillis,
                clockNowMillis
            )

            ParseResult(
                success = true,
                expense = Expense(
                    date = occurrence.date,
                    time = occurrence.time,
                    merchant = dateTimeMatch.groupValues[3].trim(),
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = resolveCardType(cardToken, mainCardToken).key,
                    cardLastFour = CardLabelFormatter.formatCardLabel("삼성", cardToken)
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

}
