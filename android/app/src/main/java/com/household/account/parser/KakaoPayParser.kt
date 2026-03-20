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

    fun matches(notificationText: String): Boolean {
        val normalized = normalize(notificationText)
        return paymentTitlePattern.containsMatchIn(normalized) &&
            paymentBodyPattern.containsMatchIn(normalized)
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null
    ): ParseResult {
        return try {
            val normalized = normalize(notificationText)
            if (!paymentTitlePattern.containsMatchIn(normalized)) {
                return ParseResult(false, errorMessage = "Kakao Pay payment title not found")
            }

            val paymentMatch = paymentBodyPattern.find(normalized)
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

    private fun normalize(value: String): String {
        val lines = value
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .dropWhile { it == "카카오페이" }

        return lines
            .joinToString(" ")
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
