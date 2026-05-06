package com.household.account.parser

import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object SejongLocalCurrencyParser {

    private const val CARD_LABEL = "여민전"
    private val paymentPattern = Regex("""결제\s*완료\s*([\d,]+)원""")
    private val balancePattern = Regex("""여민전\s*총\s*보유\s*잔액\s*([\d,]+)원""")

    fun matches(notificationText: String): Boolean {
        return notificationText.contains(CARD_LABEL) &&
            (
                paymentPattern.containsMatchIn(notificationText) ||
                    balancePattern.containsMatchIn(notificationText)
                )
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null
    ): ParseResult {
        return try {
            val paymentMatch = paymentPattern.find(notificationText)
                ?: return ParseResult(false, errorMessage = "Sejong local currency payment format not found")
            val amount = paymentMatch.groupValues[1].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")
            val merchant = extractMerchant(notificationText)
            val occurredAt = resolveDateTime(postedAtMillis)

            ParseResult(
                success = true,
                expense = Expense(
                    date = occurredAt.format(DateTimeFormatter.ISO_LOCAL_DATE),
                    time = occurredAt.format(DateTimeFormatter.ofPattern("HH:mm")),
                    merchant = merchant,
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = "local_currency",
                    cardLastFour = CARD_LABEL
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Sejong local currency parse failed: ${e.message}")
        }
    }

    fun parseBalance(notificationText: String): LocalCurrencyBalanceResult {
        val balance = balancePattern.find(notificationText)
            ?.groupValues
            ?.getOrNull(1)
            ?.replace(",", "")
            ?.toIntOrNull()

        return LocalCurrencyBalanceResult(balance, CARD_LABEL)
    }

    private fun extractMerchant(notificationText: String): String {
        val lines = notificationText
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        val paymentIndex = lines.indexOfFirst { paymentPattern.containsMatchIn(it) }
        if (paymentIndex >= 0 && paymentIndex + 1 < lines.size) {
            val candidate = lines[paymentIndex + 1]
            if (isMerchantCandidate(candidate)) {
                return candidate
            }
        }

        return lines.firstOrNull(::isMerchantCandidate) ?: "알 수 없음"
    }

    private fun isMerchantCandidate(value: String): Boolean {
        if (value.isBlank()) return false
        if (value == CARD_LABEL) return false
        if (paymentPattern.containsMatchIn(value)) return false
        if (balancePattern.containsMatchIn(value)) return false
        return value.length in 2..60
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
