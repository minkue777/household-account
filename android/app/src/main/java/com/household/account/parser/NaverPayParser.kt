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
        """(.+?)에서\s*([\d,]+)원\s*결제(?:되었습니다|되었어요|됐어요)"""
    )

    fun matches(notificationText: String): Boolean {
        val normalized = normalize(notificationText)
        return normalized.contains("네이버페이") &&
            !normalized.contains("충전") &&
            paymentPattern.containsMatchIn(normalized)
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null
    ): ParseResult {
        return try {
            val normalized = normalize(notificationText)
            val paymentMatch = paymentPattern.find(normalized)
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
                    cardLastFour = ""
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Naver Pay parse failed: ${e.message}")
        }
    }

    private fun normalize(value: String): String {
        val lines = value
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .dropWhile { it == "네이버페이" }

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
