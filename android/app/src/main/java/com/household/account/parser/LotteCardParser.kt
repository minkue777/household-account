package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import com.household.account.util.CardLabelFormatter
import java.time.LocalDate
import java.time.format.DateTimeFormatter

object LotteCardParser {

    private val amountPattern = Regex("""([\d,]+)원\s*(승인|취소)""")
    private val cardTokenPattern = Regex("""\(([0-9*xX]{4})\)""")
    private val installmentDateTimePattern = Regex("""(?:일시불|할부[^,]*)\s*,\s*(\d{2}/\d{2})\s+(\d{2}:\d{2})""")

    fun matches(notificationText: String): Boolean {
        return amountPattern.containsMatchIn(notificationText) &&
            cardTokenPattern.containsMatchIn(notificationText) &&
            installmentDateTimePattern.containsMatchIn(notificationText) &&
            (
                notificationText.contains("카드이용") ||
                    notificationText.contains("롯데카드") ||
                    notificationText.contains("일시불")
                )
    }

    fun parse(
        notificationText: String,
        mainCardToken: String? = null
    ): ParseResult {
        return try {
            val lines = notificationText
                .lines()
                .map { it.trim() }
                .filter { it.isNotEmpty() }

            val amountLineIndex = lines.indexOfFirst { amountPattern.containsMatchIn(it) }
            if (amountLineIndex < 0) {
                return ParseResult(false, errorMessage = "Lotte amount line not found")
            }

            val amountMatch = amountPattern.find(lines[amountLineIndex])
                ?: return ParseResult(false, errorMessage = "Lotte amount not found")
            val cardLineIndex = lines.indexOfFirst { cardTokenPattern.containsMatchIn(it) }
            if (cardLineIndex < 0) {
                return ParseResult(false, errorMessage = "Lotte card token line not found")
            }

            val cardMatch = cardTokenPattern.find(lines[cardLineIndex])
                ?: return ParseResult(false, errorMessage = "Lotte card token not found")
            val dateTimeLineIndex = lines.indexOfFirst { installmentDateTimePattern.containsMatchIn(it) }
            if (dateTimeLineIndex < 0) {
                return ParseResult(false, errorMessage = "Lotte date/time line not found")
            }

            val dateTimeMatch = installmentDateTimePattern.find(lines[dateTimeLineIndex])
                ?: return ParseResult(false, errorMessage = "Lotte date/time not found")
            val merchant = extractMerchant(lines, amountLineIndex)
            val cardToken = cardMatch.groupValues[1]
            val eventType = if (amountMatch.groupValues[2] == "취소") {
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
                    merchant = merchant,
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = resolveCardType(cardToken, mainCardToken).key,
                    cardLastFour = CardLabelFormatter.formatCardLabel("롯데", cardToken)
                ),
                eventType = eventType
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Lotte parse failed: ${e.message}")
        }
    }

    private fun extractMerchant(lines: List<String>, amountLineIndex: Int): String {
        for (index in amountLineIndex - 1 downTo 0) {
            val candidate = normalizeMerchant(lines[index]) ?: continue
            return candidate
        }

        return "알수없음"
    }

    private fun normalizeMerchant(value: String): String? {
        if (value.isBlank()) return null
        if (value == "카드이용" || value == "롯데카드") return null
        if (value.matches(Regex("""^\d+일\s*전$"""))) return null
        if (amountPattern.containsMatchIn(value)) return null
        if (cardTokenPattern.containsMatchIn(value)) return null
        if (installmentDateTimePattern.containsMatchIn(value)) return null
        return value
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
