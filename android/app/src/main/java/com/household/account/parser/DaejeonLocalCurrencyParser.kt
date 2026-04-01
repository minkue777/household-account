package com.household.account.parser

import com.household.account.data.Category
import com.household.account.data.Expense

object DaejeonLocalCurrencyParser {

    private val detailedPaymentPattern = Regex(
        """([^\s]+(?:\s*[^\s]+)?)\s+체크카드\((\d{4})\)\s+승인\s+([\d,]+)원(?:\s+캐시백적립\s+[\d,]+원)?\s+(\d{2}/\d{2})\s+(\d{2}:\d{2})\s+(.+?)\s+잔액\s*([\d,]+)원"""
    )
    private val cardLastFourPattern = Regex("""체크카드\((\d{4})\)""")
    private val dateTimePattern = Regex("""(\d{2}/\d{2})\s+(\d{2}:\d{2})""")

    private val daejeonHints = listOf(
        "온통대전",
        "대전사랑카드",
        "체크카드(",
        "캐시백적립"
    )

    fun matches(notificationText: String): Boolean {
        val normalized = LocalCurrencyParsingSupport.normalizeInline(notificationText)
        val hasHint = daejeonHints.any { notificationText.contains(it, ignoreCase = true) }
        val hasPayment = detailedPaymentPattern.containsMatchIn(normalized) ||
            LocalCurrencyParsingSupport.paymentPatterns.any { it.containsMatchIn(notificationText) }

        return hasHint && hasPayment
    }

    fun parse(notificationText: String): ParseResult {
        parseDetailedFormat(notificationText)?.let { return it }
        return parseFallbackFormat(notificationText)
    }

    fun parseBalance(notificationText: String): LocalCurrencyBalanceResult {
        val normalized = LocalCurrencyParsingSupport.normalizeInline(notificationText)
        val currencyType = extractCurrencyType(notificationText)

        detailedPaymentPattern.find(normalized)?.let {
            val balance = it.groupValues[7].replace(",", "").toIntOrNull()
            if (balance != null) {
                return LocalCurrencyBalanceResult(balance, it.groupValues[1].trim())
            }
        }

        for (pattern in LocalCurrencyParsingSupport.balancePatterns) {
            val match = pattern.find(notificationText) ?: continue
            val balance = match.groupValues[1].replace(",", "").toIntOrNull() ?: continue
            return LocalCurrencyBalanceResult(balance, currencyType)
        }

        return LocalCurrencyBalanceResult(null, currencyType)
    }

    private fun parseDetailedFormat(notificationText: String): ParseResult? {
        val normalized = LocalCurrencyParsingSupport.normalizeInline(notificationText)
        val match = detailedPaymentPattern.find(normalized) ?: return null

        val currencyType = match.groupValues[1].trim()
        val cardLastFour = match.groupValues[2]
        val amount = match.groupValues[3].replace(",", "").toIntOrNull()
            ?: return ParseResult(false, errorMessage = "Invalid amount")
        val date = LocalCurrencyParsingSupport.resolveDate(match.groupValues[4])
        val time = match.groupValues[5]
        val merchant = match.groupValues[6].trim()

        return ParseResult(
            success = true,
            expense = Expense(
                date = date,
                time = time,
                merchant = merchant,
                amount = amount,
                category = Category.ETC.name,
                cardType = "local_currency",
                cardLastFour = formatCardLabel(cardLastFour.ifEmpty { currencyType })
            )
        )
    }

    private fun parseFallbackFormat(notificationText: String): ParseResult {
        return try {
            val paymentMatch = LocalCurrencyParsingSupport.paymentPatterns.firstNotNullOfOrNull {
                it.find(notificationText)
            } ?: return ParseResult(
                success = false,
                errorMessage = "Daejeon local currency payment format not found"
            )

            val amount = paymentMatch.groupValues[1].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")

            val lines = LocalCurrencyParsingSupport.splitLines(notificationText)
            val merchant = extractMerchant(lines, notificationText)
            val cardLastFour = cardLastFourPattern.find(notificationText)?.groupValues?.get(1)
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
                    cardLastFour = formatCardLabel(cardLastFour)
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Daejeon local currency parse failed: ${e.message}")
        }
    }

    private fun extractMerchant(lines: List<String>, notificationText: String): String {
        for (index in lines.indices) {
            val line = lines[index]
            if (dateTimePattern.containsMatchIn(line) && index + 1 < lines.size) {
                val candidate = lines[index + 1]
                if (isMerchantCandidate(candidate)) {
                    return cleanupMerchant(candidate)
                }
            }
        }

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

        val normalized = LocalCurrencyParsingSupport.normalizeInline(notificationText)
        detailedPaymentPattern.find(normalized)?.let {
            return cleanupMerchant(it.groupValues[6])
        }

        return lines.firstOrNull { isMerchantCandidate(it) }?.let(::cleanupMerchant) ?: "알수없음"
    }

    private fun isMerchantCandidate(value: String): Boolean {
        if (value.isBlank()) return false
        if (value.contains("승인") || value.contains("결제") || value.contains("사용")) return false
        if (value.contains("잔액") || value.contains("캐시백적립")) return false
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
            notificationText.contains("온통대전") -> "온통대전"
            notificationText.contains("대전사랑카드") -> "대전사랑카드"
            else -> "대전지역화폐"
        }
    }

    private fun formatCardLabel(cardLastFour: String?): String {
        return if (cardLastFour.isNullOrBlank() || !cardLastFour.matches(Regex("""\d{4}"""))) {
            "대전사랑카드"
        } else {
            "대전사랑카드($cardLastFour)"
        }
    }
}
