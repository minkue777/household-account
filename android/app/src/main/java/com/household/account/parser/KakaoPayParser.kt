package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object KakaoPayParser {

    private val paymentTitlePattern = Regex("""결제가\s*완료되었어요""")
    private val paymentBodyPattern = Regex("""(.+?)에서\s*([\d,]+)원을\s*결제했어요\.?""")
    private val appNamePrefixPattern = Regex("""^카카오페이\s*""")
    private val titlePrefixPattern = Regex("""^결제가\s*완료되었어요\s*""")

    fun matches(notificationText: String): Boolean {
        val lines = normalizeLines(notificationText)
        return lines.any { line ->
            val sanitized = sanitizePaymentLine(line)
            paymentBodyPattern.containsMatchIn(sanitized)
        } || sanitizePaymentLine(lines.joinToString(" ")).let { paymentBodyPattern.containsMatchIn(it) }
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null
    ): ParseResult {
        return try {
            val lines = normalizeLines(notificationText)
            val combinedLine = sanitizePaymentLine(lines.joinToString(" "))
            val paymentLine = lines
                .map(::sanitizePaymentLine)
                .firstOrNull { paymentBodyPattern.containsMatchIn(it) }
                ?: if (paymentBodyPattern.containsMatchIn(combinedLine)) combinedLine else null
                ?: return ParseResult(false, errorMessage = "Kakao Pay payment body not found")

            if (!paymentTitlePattern.containsMatchIn(lines.joinToString(" "))) {
                return ParseResult(false, errorMessage = "Kakao Pay payment title not found")
            }

            val paymentMatch = paymentBodyPattern.find(paymentLine)
                ?: return ParseResult(false, errorMessage = "Kakao Pay payment body not found")

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
                    cardLastFour = "카카오페이"
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Kakao Pay parse failed: ${e.message}")
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
            .replace(appNamePrefixPattern, "")
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
