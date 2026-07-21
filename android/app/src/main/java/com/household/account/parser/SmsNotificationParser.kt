package com.household.account.parser

object SmsNotificationParser {

    private val knownSmsPackages = setOf(
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.mms"
    )

    fun isSupportedPackage(packageName: String): Boolean {
        return packageName in knownSmsPackages
    }

    fun matches(packageName: String, notificationText: String): Boolean {
        if (!isSupportedPackage(packageName)) {
            return false
        }

        return buildCandidates(notificationText).any { candidate ->
            matchesAnyCardParser(candidate) || SmsCardMessageParser.matches(candidate)
        }
    }

    fun parse(
        notificationText: String,
        postedAtMillis: Long? = null,
        clockNowMillis: Long? = null
    ): ParseResult {
        val candidates = buildCandidates(notificationText)
        for (candidate in candidates) {
            val result = parseWithKnownParsers(candidate, postedAtMillis, clockNowMillis)
            if (result.success) {
                return result
            }

            val smsResult = SmsCardMessageParser.parse(candidate, postedAtMillis, clockNowMillis)
            if (smsResult.success) {
                return smsResult
            }
        }

        return ParseResult(false, errorMessage = "SMS notification format not supported")
    }

    private fun buildCandidates(notificationText: String): List<String> {
        val lines = notificationText
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        if (lines.isEmpty()) {
            return emptyList()
        }

        val candidates = linkedSetOf<String>()
        candidates += lines.joinToString("\n")

        if (lines.size >= 2) {
            candidates += lines.drop(1).joinToString("\n")
        }

        if (lines.size >= 3) {
            candidates += lines.drop(2).joinToString("\n")
        }

        return candidates
            .map { it.trim() }
            .filter { it.isNotEmpty() }
    }

    private fun matchesAnyCardParser(notificationText: String): Boolean {
        return KBCardParser.matches(notificationText) ||
            NHPayParser.matches(notificationText) ||
            NaverPayParser.matches(notificationText) ||
            TossBankParser.matches(notificationText) ||
            KakaoPayParser.matches(notificationText) ||
            DigitalOnnuriParser.matches(notificationText) ||
            PayboocISPParser.matches(notificationText) ||
            SamsungCardParser.matches(notificationText) ||
            LotteCardParser.matches(notificationText) ||
            GyeonggiLocalCurrencyParser.matches(notificationText) ||
            DaejeonLocalCurrencyParser.matches(notificationText)
    }

    private fun parseWithKnownParsers(
        notificationText: String,
        postedAtMillis: Long?,
        clockNowMillis: Long?
    ): ParseResult {
        val parsers = listOf(
            { text: String -> KBCardParser.parse(text, postedAtMillis = postedAtMillis, clockNowMillis = clockNowMillis) },
            { text: String -> NHPayParser.parse(text, postedAtMillis = postedAtMillis, clockNowMillis = clockNowMillis) },
            { text: String -> NaverPayParser.parse(text, postedAtMillis, clockNowMillis) },
            { text: String -> TossBankParser.parse(text, postedAtMillis, clockNowMillis) },
            { text: String -> KakaoPayParser.parse(text, postedAtMillis, clockNowMillis) },
            { text: String -> DigitalOnnuriParser.parse(text, postedAtMillis, clockNowMillis) },
            { text: String -> PayboocISPParser.parse(text, postedAtMillis, clockNowMillis) },
            { text: String -> SamsungCardParser.parse(text, postedAtMillis = postedAtMillis, clockNowMillis = clockNowMillis) },
            { text: String -> LotteCardParser.parse(text, postedAtMillis = postedAtMillis, clockNowMillis = clockNowMillis) },
            { text: String -> GyeonggiLocalCurrencyParser.parse(text, postedAtMillis, clockNowMillis) },
            { text: String -> DaejeonLocalCurrencyParser.parse(text, postedAtMillis, clockNowMillis) }
        )

        for (parser in parsers) {
            val result = parser(notificationText)
            if (result.success) {
                return result
            }
        }

        return ParseResult(false, errorMessage = "SMS notification parse failed")
    }
}
