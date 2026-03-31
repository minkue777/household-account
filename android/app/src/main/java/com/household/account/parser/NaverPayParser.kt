package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object NaverPayParser {

    private val paymentPattern = Regex(
        """(.+?)에서\s*([\d,]+)원을?\s*결제(?:했습니다|했어요|됐어요)"""
    )
    private val titlePrefixPattern = Regex("""^네이버페이\s*""")

    fun matches(notificationText: String): Boolean {
        val lines = normalizeLines(notificationText)
        val hasNaverMarker = lines.any { titlePrefixPattern.containsMatchIn(it) } ||
            notificationText.contains("네이버페이")

        if (!hasNaverMarker) {
            return false
        }

        return lines.any { line ->
            val sanitized = sanitizePaymentLine(line)
            paymentPattern.containsMatchIn(sanitized)
        }
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null
    ): ParseResult {
        return try {
            val lines = normalizeLines(notificationText)
            val hasNaverMarker = lines.any { titlePrefixPattern.containsMatchIn(it) } ||
                notificationText.contains("네이버페이")

            if (!hasNaverMarker) {
                return ParseResult(false, errorMessage = "Naver Pay marker not found")
            }

            val paymentLine = lines
                .map(::sanitizePaymentLine)
                .firstOrNull { paymentPattern.containsMatchIn(it) }
                ?: return ParseResult(false, errorMessage = "Naver Pay payment format not found")

            val paymentMatch = paymentPattern.find(paymentLine)
                ?: return ParseResult(false, errorMessage = "Naver Pay payment format not found")

            val merchant = paymentMatch.groupValues[1].trim()
            val amount = paymentMatch.groupValues[2].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")

            val occurredAt = resolveDateTime(postedAtMillis)

            ParseResult(
                success = true,
                expense = Expense(
                    date = occurredAt.format(DateTimeFormatter.ISO_LOCAL_DATE),
                    time = occurredAt.format(DateTimeFormatter.ofPattern("HH:mm")),
                    merchant = merchant,
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = CardType.MAIN.key,
                    cardLastFour = "네이버페이"
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Naver Pay parse failed: ${e.message}")
        }
    }

    private fun normalizeLines(value: String): List<String> {
        return value
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
    }

    private fun sanitizePaymentLine(value: String): String {
        return value
            .replace(titlePrefixPattern, "")
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
