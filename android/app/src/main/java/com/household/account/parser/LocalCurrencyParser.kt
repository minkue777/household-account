package com.household.account.parser

import com.household.account.data.Category
import com.household.account.data.Expense
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

object LocalCurrencyParser {

    data class BalanceResult(
        val balance: Int?,
        val currencyType: String? = null
    )

    private val detailedPaymentPattern = Regex(
        """([^\s]+(?:\s*[^\s]+)?)\s+체크카드\((\d{4})\)\s+승인\s+([\d,]+)원(?:\s+캐시백적립\s+[\d,]+원)?\s+(\d{2}/\d{2})\s+(\d{2}:\d{2})\s+(.+?)\s+잔액\s*([\d,]+)원"""
    )
    private val cardLastFourPattern = Regex("""체크카드\((\d{4})\)""")
    private val dateTimePattern = Regex("""(\d{2}/\d{2})\s+(\d{2}:\d{2})""")

    private val balancePatterns = listOf(
        Regex("""잔액\s*([\d,]+)원"""),
        Regex("""총\s*보유\s*잔액\s*\n?\s*([\d,]+)원"""),
        Regex("""보유\s*잔액\s*[:\s]*([\d,]+)원""")
    )

    private val paymentPatterns = listOf(
        Regex("""결제\s*완료\s*([\d,]+)원"""),
        Regex("""결제\s*([\d,]+)원"""),
        Regex("""승인\s*([\d,]+)원"""),
        Regex("""사용\s*완료?\s*([\d,]+)원"""),
        Regex("""([\d,]+)원\s*결제"""),
        Regex("""([\d,]+)원\s*승인""")
    )

    private val localCurrencyHints = listOf(
        "지역화폐",
        "온통대전",
        "대전사랑카드",
        "체크카드(",
        "캐시백적립"
    )

    fun matches(notificationText: String): Boolean {
        val normalized = normalizeInline(notificationText)
        val hasHint = localCurrencyHints.any { notificationText.contains(it, ignoreCase = true) } ||
            (notificationText.contains("체크카드(") && notificationText.contains("잔액"))
        val hasPayment = detailedPaymentPattern.containsMatchIn(normalized) ||
            paymentPatterns.any { it.containsMatchIn(notificationText) }

        return hasHint && hasPayment
    }

    fun parse(notificationText: String): ParseResult {
        parseDetailedFormat(notificationText)?.let { return it }
        return parseFallbackFormat(notificationText)
    }

    fun parseBalance(notificationText: String): BalanceResult {
        val normalized = normalizeInline(notificationText)
        val currencyType = extractCurrencyType(notificationText)

        detailedPaymentPattern.find(normalized)?.let {
            val balance = it.groupValues[7].replace(",", "").toIntOrNull()
            if (balance != null) {
                return BalanceResult(balance, it.groupValues[1].trim())
            }
        }

        for (pattern in balancePatterns) {
            val match = pattern.find(notificationText) ?: continue
            val balance = match.groupValues[1].replace(",", "").toIntOrNull() ?: continue
            return BalanceResult(balance, currencyType)
        }

        return BalanceResult(null, currencyType)
    }

    private fun parseDetailedFormat(notificationText: String): ParseResult? {
        val normalized = normalizeInline(notificationText)
        val match = detailedPaymentPattern.find(normalized) ?: return null

        val currencyType = match.groupValues[1].trim()
        val cardLastFour = match.groupValues[2]
        val amount = match.groupValues[3].replace(",", "").toIntOrNull()
            ?: return ParseResult(false, errorMessage = "Invalid amount")
        val date = resolveDate(match.groupValues[4])
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
                cardLastFour = cardLastFour.ifEmpty { currencyType }
            )
        )
    }

    private fun parseFallbackFormat(notificationText: String): ParseResult {
        return try {
            val paymentMatch = paymentPatterns.firstNotNullOfOrNull { it.find(notificationText) }
                ?: return ParseResult(false, errorMessage = "Local currency payment format not found")

            val amount = paymentMatch.groupValues[1].replace(",", "").toIntOrNull()
                ?: return ParseResult(false, errorMessage = "Invalid amount")

            val lines = notificationText
                .split("\n")
                .map { it.trim() }
                .filter { it.isNotEmpty() }

            val merchant = extractMerchant(lines, notificationText)
            val cardLastFour = cardLastFourPattern.find(notificationText)?.groupValues?.get(1) ?: "지역"
            val dateTime = extractDateTime(notificationText)

            ParseResult(
                success = true,
                expense = Expense(
                    date = dateTime.first,
                    time = dateTime.second,
                    merchant = merchant,
                    amount = amount,
                    category = Category.ETC.name,
                    cardType = "local_currency",
                    cardLastFour = cardLastFour
                )
            )
        } catch (e: Exception) {
            ParseResult(false, errorMessage = "Local currency parse failed: ${e.message}")
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
            if ((line.contains("결제") || line.contains("승인") || line.contains("사용")) && index + 1 < lines.size) {
                val candidate = lines[index + 1]
                if (isMerchantCandidate(candidate)) {
                    return cleanupMerchant(candidate)
                }
            }
        }

        val normalized = normalizeInline(notificationText)
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

    private fun extractDateTime(notificationText: String): Pair<String, String> {
        val match = dateTimePattern.find(notificationText)
        if (match != null) {
            return resolveDate(match.groupValues[1]) to match.groupValues[2]
        }

        val today = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE)
        val now = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"))
        return today to now
    }

    private fun extractCurrencyType(notificationText: String): String {
        val normalized = normalizeInline(notificationText)
        detailedPaymentPattern.find(normalized)?.let {
            return it.groupValues[1].trim()
        }

        return when {
            notificationText.contains("온통대전") -> "온통대전"
            notificationText.contains("경기지역화폐") -> "경기지역화폐"
            notificationText.contains("지역화폐") -> "지역화폐"
            else -> "지역화폐"
        }
    }

    private fun normalizeInline(value: String): String {
        return value
            .lines()
            .joinToString(" ") { it.trim() }
            .replace(Regex("""\s+"""), " ")
            .trim()
    }

    private fun resolveDate(dateValue: String): String {
        val currentYear = LocalDate.now().year
        val (month, day) = dateValue.split("/").map { it.toInt() }
        val date = LocalDate.of(currentYear, month, day)
        return date.format(DateTimeFormatter.ISO_LOCAL_DATE)
    }
}
