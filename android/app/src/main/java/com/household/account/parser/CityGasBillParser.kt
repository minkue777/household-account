package com.household.account.parser

import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object CityGasBillParser {

    const val CARD_TYPE = "bill"

    private val billTitlePattern = Regex("""\[(\d{4})년\s*(\d{1,2})월\s*도시가스요금\s*청구서]""")
    private val amountPattern = Regex("""납부하실\s*총\s*금액은\s*([\d,]+)\s*원""")
    private val dueDatePattern = Regex("""납부마감일은\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일""")

    fun matches(notificationText: String): Boolean {
        val normalized = normalizeInline(notificationText)
        return normalized.contains("도시가스요금 청구서") &&
            amountPattern.containsMatchIn(normalized)
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null
    ): ParseResult {
        return try {
            val normalized = normalizeInline(notificationText)
            val titleMatch = billTitlePattern.find(normalized)
            val amountMatch = amountPattern.find(normalized)
                ?: return ParseResult(false, errorMessage = "City gas bill amount format not found")
            val amount = amountMatch.groupValues[1].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")
            val billMonth = titleMatch?.groupValues?.getOrNull(2)?.toIntOrNull()
            val occurredAt = resolveDateTime(postedAtMillis)

            ParseResult(
                success = true,
                expense = Expense(
                    date = resolveDueDate(normalized) ?: occurredAt.format(DateTimeFormatter.ISO_LOCAL_DATE),
                    time = occurredAt.format(DateTimeFormatter.ofPattern("HH:mm")),
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
        val match = dueDatePattern.find(normalizedText) ?: return null
        val year = match.groupValues[1].toIntOrNull() ?: return null
        val month = match.groupValues[2].toIntOrNull() ?: return null
        val day = match.groupValues[3].toIntOrNull() ?: return null

        return LocalDate.of(year, month, day).format(DateTimeFormatter.ISO_LOCAL_DATE)
    }

    private fun normalizeInline(value: String): String {
        return value
            .lines()
            .joinToString(" ") { it.trim() }
            .replace(Regex("""\s+"""), " ")
            .trim()
    }

    private fun resolveDateTime(postedAtMillis: Long?): LocalDateTime {
        return if (postedAtMillis != null && postedAtMillis > 0L) {
            Instant.ofEpochMilli(postedAtMillis)
                .atZone(ZoneId.systemDefault())
                .toLocalDateTime()
        } else {
            LocalDateTime.now()
        }
    }
}
