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
}
