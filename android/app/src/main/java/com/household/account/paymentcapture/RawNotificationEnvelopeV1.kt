package com.household.account.paymentcapture

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

data class RawNotificationContentV1(
    val postedAt: String,
    val title: String = "",
    val text: String = "",
    val bigText: String = "",
    val textLines: List<String> = emptyList()
) {
    fun toMap(): Map<String, Any> = mapOf(
        "postedAt" to postedAt,
        "title" to title,
        "text" to text,
        "bigText" to bigText,
        "textLines" to textLines
    )
}

data class RawNotificationEnvelopeV1(
    override val observationId: String,
    val packageName: String,
    val notification: RawNotificationContentV1
) : CaptureDeliveryEnvelope {
    override fun toMap(): Map<String, Any> = mapOf(
        "contractVersion" to CONTRACT_VERSION,
        "observationId" to observationId,
        "packageName" to packageName,
        "notification" to notification.toMap()
    )

    override fun toJson(): String = JSONObject(toMap()).toString()

    companion object {
        const val CONTRACT_VERSION = "android-raw-notification.v1"

        fun create(
            packageName: String,
            postedAtMillis: Long,
            title: String,
            text: String,
            bigText: String,
            textLines: List<String>,
            observationId: String = "observation.android.${UUID.randomUUID().toString().replace("-", "")}"
        ): RawNotificationEnvelopeV1 {
            val postedAt = DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(
                Instant.ofEpochMilli(postedAtMillis.coerceAtLeast(0L))
                    .atZone(ZoneId.of("Asia/Seoul"))
            )
            var remaining = MAX_TOTAL_TEXT_LENGTH
            fun bounded(value: String, maximum: Int): String {
                val result = value.take(minOf(maximum, remaining))
                remaining -= result.length
                return result
            }
            val boundedTitle = bounded(title, MAX_TITLE_LENGTH)
            val boundedLines = textLines.take(MAX_TEXT_LINES).map { line ->
                bounded(line, MAX_TEXT_LINE_LENGTH)
            }
            val boundedBigText = bounded(bigText, MAX_BIG_TEXT_LENGTH)
            val boundedText = bounded(text, MAX_TEXT_LENGTH)

            return RawNotificationEnvelopeV1(
                observationId = observationId,
                packageName = packageName,
                notification = RawNotificationContentV1(
                    postedAt = postedAt,
                    title = boundedTitle,
                    text = boundedText,
                    bigText = boundedBigText,
                    textLines = boundedLines
                )
            )
        }

        fun fromJson(value: String): RawNotificationEnvelopeV1 {
            val root = JSONObject(value)
            require(root.getString("contractVersion") == CONTRACT_VERSION)
            val notification = root.getJSONObject("notification")
            val lines = notification.optJSONArray("textLines") ?: JSONArray()
            return RawNotificationEnvelopeV1(
                observationId = root.getString("observationId"),
                packageName = root.getString("packageName"),
                notification = RawNotificationContentV1(
                    postedAt = notification.getString("postedAt"),
                    title = notification.optString("title", ""),
                    text = notification.optString("text", ""),
                    bigText = notification.optString("bigText", ""),
                    textLines = buildList {
                        for (index in 0 until lines.length()) {
                            add(lines.getString(index))
                        }
                    }
                )
            )
        }

        private const val MAX_TOTAL_TEXT_LENGTH = 65_536
        private const val MAX_TITLE_LENGTH = 4_096
        private const val MAX_TEXT_LENGTH = 32_768
        private const val MAX_BIG_TEXT_LENGTH = 65_536
        private const val MAX_TEXT_LINES = 32
        private const val MAX_TEXT_LINE_LENGTH = 4_096
    }
}
