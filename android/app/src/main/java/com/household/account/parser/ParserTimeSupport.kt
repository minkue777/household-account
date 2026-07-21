package com.household.account.parser

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal data class ParserOccurrence(
    val date: String,
    val time: String
)

internal object ParserTimeSupport {
    private val seoul = ZoneId.of("Asia/Seoul")
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    fun receivedAt(
        postedAtMillis: Long?,
        clockNowMillis: Long? = null
    ): LocalDateTime {
        val millis = postedAtMillis?.takeIf { it > 0L }
            ?: clockNowMillis?.takeIf { it > 0L }
            ?: System.currentTimeMillis()
        return Instant.ofEpochMilli(millis).atZone(seoul).toLocalDateTime()
    }

    fun resolveOccurrence(
        dateValue: String,
        timeValue: String,
        postedAtMillis: Long?,
        clockNowMillis: Long? = null
    ): ParserOccurrence {
        val (month, day) = dateValue.split("/").map { it.toInt() }
        val (hour, minute) = timeValue.split(":").map { it.toInt() }
        require(hour in 0..23 && minute in 0..59) { "Invalid time" }

        val receivedAt = receivedAt(postedAtMillis, clockNowMillis)
        for (year in receivedAt.year downTo receivedAt.year - 8) {
            val candidate = runCatching {
                LocalDateTime.of(year, month, day, hour, minute)
            }.getOrNull() ?: continue
            if (!candidate.isAfter(receivedAt)) {
                return ParserOccurrence(
                    date = candidate.toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE),
                    time = candidate.toLocalTime().format(timeFormatter)
                )
            }
        }
        error("Valid past occurrence not found")
    }

    fun postedTime(postedAtMillis: Long?): String? {
        val millis = postedAtMillis?.takeIf { it > 0L } ?: return null
        return Instant.ofEpochMilli(millis)
            .atZone(seoul)
            .toLocalTime()
            .format(timeFormatter)
    }
}
