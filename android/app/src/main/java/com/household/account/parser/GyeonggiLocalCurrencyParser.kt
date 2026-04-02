package com.household.account.parser

import com.household.account.data.Category
import com.household.account.data.Expense

object GyeonggiLocalCurrencyParser {

    private val dateTimePattern = Regex("""(?:\d{4}/)?(\d{2}/\d{2})\s+(\d{2}:\d{2})""")

    private val gyeonggiHints = listOf(
        "경기지역화폐",
        "희망화성",
        "희망화성지역화폐",
        "착한페이",
        "특례시기념"
    )

    fun matches(notificationText: String): Boolean {
        val hasHint = gyeonggiHints.any { notificationText.contains(it, ignoreCase = true) }
        val hasPayment = LocalCurrencyParsingSupport.paymentPatterns.any {
            it.containsMatchIn(notificationText)
        }
        val hasBalance = LocalCurrencyParsingSupport.balancePatterns.any {
            it.containsMatchIn(notificationText)
        }

        return hasHint && (hasPayment || hasBalance)
    }

    fun parse(notificationText: String): ParseResult {
        return try {
            val paymentMatch = LocalCurrencyParsingSupport.paymentPatterns.firstNotNullOfOrNull {
                it.find(notificationText)
            } ?: return ParseResult(
                success = false,
                errorMessage = "Gyeonggi local currency payment format not found"
            )

            val amount = paymentMatch.groupValues[1].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")

            val lines = LocalCurrencyParsingSupport.splitLines(notificationText)
            val merchant = extractMerchant(lines)
            val dateTime = LocalCurrencyParsingSupport.extractDateTime(notificationText, dateTimePattern)

            ParseResult(
                success = true,
                expense = Expense(
                    date = dateTime.first,
                    time = dateTime.second,
                    merchant = merchant,
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = "local_currency",
                    cardLastFour = "경기지역화폐"
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Gyeonggi local currency parse failed: ${e.message}")
        }
    }

    fun parseBalance(notificationText: String): LocalCurrencyBalanceResult {
        for (pattern in LocalCurrencyParsingSupport.balancePatterns) {
            val match = pattern.find(notificationText) ?: continue
            val balance = match.groupValues[1].replace(",", "").toIntOrNull() ?: continue
            return LocalCurrencyBalanceResult(balance, extractCurrencyType(notificationText))
        }

        return LocalCurrencyBalanceResult(null, extractCurrencyType(notificationText))
    }

    private fun extractMerchant(lines: List<String>): String {
        for (index in lines.indices) {
            val line = lines[index]
            if ((line.contains("결제") || line.contains("승인") || line.contains("사용")) &&
                index + 1 < lines.size
            ) {
                val candidate = lines[index + 1]
                if (isMerchantCandidate(candidate)) {
                    return cleanupMerchant(candidate)
                }
            }
        }

        for (line in lines) {
            if (isMerchantCandidate(line)) {
                return cleanupMerchant(line)
            }
        }

        return "알수없음"
    }

    private fun isMerchantCandidate(value: String): Boolean {
        if (value.isBlank()) return false
        if (value.contains("결제") || value.contains("승인") || value.contains("사용")) return false
        if (value.contains("잔액") || value.contains("인센티브")) return false
        if (value.contains("지역화폐") || value.contains("착한페이")) return false
        if (value.matches(Regex("""^[\d,\s:/]+원?$"""))) return false
        if (value.startsWith("총") || value.startsWith("누적")) return false
        return value.length in 2..60
    }

    private fun cleanupMerchant(value: String): String {
        return value
            .replace(Regex("""\s+잔액\s*[\d,]+원$"""), "")
            .trim()
    }

    private fun extractCurrencyType(notificationText: String): String {
        return when {
            notificationText.contains("희망화성지역화폐") -> "희망화성지역화폐"
            notificationText.contains("희망화성") -> "희망화성지역화폐"
            notificationText.contains("경기지역화폐") -> "경기지역화폐"
            notificationText.contains("착한페이") -> "착한페이"
            else -> "지역화폐"
        }
    }
}
