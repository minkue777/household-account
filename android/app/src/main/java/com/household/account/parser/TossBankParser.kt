package com.household.account.parser

import com.household.account.data.CardType
import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

object TossBankParser {

    private val amountEventPattern = Regex("""([\d,]+)원\s*(결제(?:\s*취소)?)""")
    private val merchantPattern = Regex("""(?:토스뱅크\s*체크카드|페이스페이\s*\(토스뱅크\))\s*\|\s*(.+)""")
    private val amountLineMerchantPattern = Regex("""[\d,]+원\s*결제(?:\s*취소)?\s*\|\s*(.+)""")
    private val cashbackPattern = Regex("""(?m)^([\d,]+)원\s*캐시백""")

    fun matches(notificationText: String): Boolean {
        val normalized = normalize(notificationText)
        return amountEventPattern.containsMatchIn(normalized) &&
            (
                merchantPattern.containsMatchIn(normalized) ||
                    amountLineMerchantPattern.containsMatchIn(normalized)
            )
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null,
        clockNowMillis: Long? = null
    ): ParseResult {
        return try {
            val normalized = normalize(notificationText)
            val amountEventMatch = amountEventPattern.find(normalized)
                ?: return ParseResult(false, errorMessage = "Toss Bank amount/event format not found")
            val merchantMatch = merchantPattern.find(normalized)
                ?: amountLineMerchantPattern.find(normalized)
                ?: return ParseResult(false, errorMessage = "Toss Bank merchant format not found")

            val merchant = merchantMatch.groupValues[1].trim()
            if (merchant.contains("가승인")) {
                return ParseResult(false, errorMessage = "Toss Bank pre-authorization ignored")
            }

            val grossAmount = amountEventMatch.groupValues[1].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")
            val eventType = if (amountEventMatch.groupValues[2].contains("취소")) {
                ExpenseEventType.CANCELLATION
            } else {
                ExpenseEventType.APPROVAL
            }
            val cashbackAmount = cashbackPattern.find(normalized)
                ?.groupValues
                ?.get(1)
                ?.replace(",", "")
                ?.toIntOrNull()
                ?: 0
            val amount = if (eventType == ExpenseEventType.APPROVAL && cashbackAmount > 0) {
                (grossAmount - cashbackAmount).coerceAtLeast(0)
            } else {
                grossAmount
            }
            val occurredAt = resolveDateTime(postedAtMillis, clockNowMillis)

            ParseResult(
                success = true,
                expense = Expense(
                    date = occurredAt.format(DateTimeFormatter.ISO_LOCAL_DATE),
                    time = occurredAt.format(DateTimeFormatter.ofPattern("HH:mm")),
                    merchant = merchant,
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = CardType.MAIN.key,
                    cardLastFour = "토스"
                ),
                eventType = eventType
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Toss Bank parse failed: ${e.message}")
        }
    }

    private fun normalize(value: String): String {
        return value
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .joinToString("\n")
            .trim()
    }

    private fun resolveDateTime(postedAtMillis: Long?, clockNowMillis: Long?): LocalDateTime {
        return ParserTimeSupport.receivedAt(postedAtMillis, clockNowMillis)
    }
}
