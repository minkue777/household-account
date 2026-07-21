package com.household.account.parser

import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.LocalDate
import java.time.format.DateTimeFormatter

object CityGasBillParser {

    const val CARD_TYPE = "bill"

    private val cityGasBillPattern = Regex("""도시가스(?:\s*요금)?\s*청구(?:\s*안내|서)""")
    private val billTitlePattern = Regex(
        """\[?(\d{4})년\s*(\d{1,2})월\s*도시가스\s*요금(?:\s*청구서)?]?"""
    )
    private val amountPatterns = listOf(
        Regex("""납부하실\s*총\s*금액은\s*([\d,]+)\s*원"""),
        Regex("""총\s*액\s*([\d,]+)\s*원""")
    )
    private val dueDatePatterns = listOf(
        Regex("""납부마감일은?\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일"""),
        Regex("""납부마감일은?\s*(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})""")
    )

    fun matches(notificationText: String): Boolean {
        val normalized = normalizeInline(notificationText)
        return cityGasBillPattern.containsMatchIn(normalized) &&
            amountPatterns.any { it.containsMatchIn(normalized) }
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null,
        clockNowMillis: Long? = null
    ): ParseResult {
        return try {
            val normalized = normalizeInline(notificationText)
            if (!cityGasBillPattern.containsMatchIn(normalized)) {
                return ParseResult(false, errorMessage = "City gas bill marker not found")
            }
            val titleMatch = billTitlePattern.find(normalized)
            val amountMatch = amountPatterns.firstNotNullOfOrNull { it.find(normalized) }
                ?: return ParseResult(false, errorMessage = "City gas bill amount format not found")
            val amount = amountMatch.groupValues[1].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")
            val occurredAt = ParserTimeSupport.receivedAt(postedAtMillis, clockNowMillis)
            val billMonth = titleMatch?.groupValues?.getOrNull(2)?.toIntOrNull()

            ParseResult(
                success = true,
                expense = Expense(
                    date = resolveDueDate(normalized)
                        ?: occurredAt.toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE),
                    time = occurredAt.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm")),
                    merchant = "${billMonth ?: occurredAt.monthValue}월 도시가스요금",
                    amount = amount,
                    category = Category.FIXED.name,
                    cardType = CARD_TYPE,
                    cardLastFour = "",
                    memo = titleMatch?.value?.removeSurrounding("[", "]").orEmpty()
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "City gas bill parse failed: ${e.message}")
        }
    }

    private fun resolveDueDate(normalizedText: String): String? {
        for (pattern in dueDatePatterns) {
            val match = pattern.find(normalizedText) ?: continue
            val year = match.groupValues[1].toIntOrNull() ?: continue
            val month = match.groupValues[2].toIntOrNull() ?: continue
            val day = match.groupValues[3].toIntOrNull() ?: continue
            return runCatching {
                LocalDate.of(year, month, day).format(DateTimeFormatter.ISO_LOCAL_DATE)
            }.getOrNull()
        }
        return null
    }

    private fun normalizeInline(value: String): String {
        return value
            .lines()
            .joinToString(" ") { it.trim() }
            .replace(Regex("""\s+"""), " ")
            .trim()
    }
}
