package com.household.account.util

object CardLabelFormatter {

    private val rawTokenPattern = Regex("""^[0-9*xX]{4}$""")
    private val labeledTokenPattern = Regex("""\(([0-9*xX]{4})\)""")

    fun formatCardLabel(label: String, cardToken: String?): String {
        val normalizedLabel = label.trim()
        val normalizedToken = cardToken?.trim().orEmpty()

        if (normalizedToken.isBlank()) {
            return normalizedLabel
        }

        return "$normalizedLabel($normalizedToken)"
    }

    fun extractCardToken(value: String): String? {
        val trimmed = value.trim()
        if (trimmed.isBlank()) {
            return null
        }

        return when {
            rawTokenPattern.matches(trimmed) -> trimmed.lowercase()
            else -> labeledTokenPattern.find(trimmed)?.groupValues?.get(1)?.lowercase()
        }
    }

    fun extractCardLabel(value: String): String? {
        val trimmed = value.trim()
        if (trimmed.isBlank() || rawTokenPattern.matches(trimmed)) {
            return null
        }

        return if (labeledTokenPattern.containsMatchIn(trimmed)) {
            trimmed.substringBefore("(").trim().ifBlank { null }
        } else {
            trimmed
        }
    }

    fun normalizeCardToken(value: String?): String? {
        if (value.isNullOrBlank()) {
            return null
        }

        val rawToken = extractCardToken(value) ?: value
        val normalized = rawToken
            .trim()
            .lowercase()
            .replace("＊", "x")
            .replace("*", "x")
            .replace(Regex("""[^0-9x]"""), "")
            .takeLast(4)

        return normalized.takeIf { it.isNotBlank() }
    }

    fun matchesCardToken(firstValue: String?, secondValue: String?): Boolean {
        val firstToken = normalizeCardToken(firstValue) ?: return false
        val secondToken = normalizeCardToken(secondValue) ?: return false

        if (firstToken == secondToken) {
            return true
        }

        if (firstToken.length != secondToken.length) {
            return false
        }

        return firstToken.indices.all { index ->
            val firstChar = firstToken[index]
            val secondChar = secondToken[index]
            firstChar == secondChar || firstChar == 'x' || secondChar == 'x'
        }
    }
}
