package com.household.account.paymentcapture

import java.security.MessageDigest

internal enum class CaptureLatencyStage(val wireName: String) {
    NOTIFICATION_RECEIVED("notification_received"),
    JOURNAL_PERSISTED("journal_persisted"),
    CALLABLE_START("callable_start"),
    CALLABLE_END("callable_end"),
    FOLLOW_UP_PERSISTED("follow_up_persisted"),
    QUICK_EDIT_LAUNCH("quick_edit_launch"),
    QUICK_EDIT_SHOWN("quick_edit_shown")
}

internal enum class CaptureLatencyOutcome(val wireName: String) {
    SUCCESS("success"),
    FAILURE("failure")
}

internal enum class CaptureLatencyLogLevel {
    DEBUG,
    INFO
}

/**
 * 결제 알림의 단조 시계 타임라인만 보관합니다.
 *
 * 가구/회원 ID, 거래 ID, 금액을 입력받지 않으며 observationId도 서버와 동일하게
 * UTF-8 SHA-256 앞 16자리 correlationId로만 로그에 남깁니다. 상세 단계는 진단 로그가
 * 켜진 경우에만 내보내고, 평상시에는 QuickEdit 표시 완료 요약 한 줄만 내보냅니다.
 */
internal class CaptureLatencyRecorder(
    private val elapsedRealtimeMillis: () -> Long,
    private val detailedLoggingEnabled: () -> Boolean,
    private val emit: (CaptureLatencyLogLevel, String) -> Unit,
    private val maxActiveTraces: Int = DEFAULT_MAX_ACTIVE_TRACES,
    private val maxTraceAgeMillis: Long = DEFAULT_MAX_TRACE_AGE_MILLIS
) {
    private data class Point(
        val elapsedRealtimeMillis: Long,
        val outcome: CaptureLatencyOutcome
    )

    private data class Timeline(
        var lastUpdatedElapsedRealtimeMillis: Long,
        val points: MutableMap<CaptureLatencyStage, Point> = mutableMapOf()
    )

    private val lock = Any()
    private val timelines = LinkedHashMap<String, Timeline>()

    fun mark(
        observationId: String,
        stage: CaptureLatencyStage,
        outcome: CaptureLatencyOutcome = CaptureLatencyOutcome.SUCCESS,
        atElapsedRealtimeMillis: Long = elapsedRealtimeMillis()
    ) {
        val correlationId = correlationIdFor(observationId) ?: return
        if (atElapsedRealtimeMillis < 0L) return

        val maintenanceElapsedRealtimeMillis = maxOf(
            atElapsedRealtimeMillis,
            runCatching { elapsedRealtimeMillis() }.getOrDefault(atElapsedRealtimeMillis)
        )
        val detailed = runCatching { detailedLoggingEnabled() }.getOrDefault(false)
        val summary = synchronized(lock) {
            prune(maintenanceElapsedRealtimeMillis)
            val timeline = timelines.getOrPut(correlationId) {
                evictOldestIfNeeded()
                Timeline(maintenanceElapsedRealtimeMillis)
            }
            if (stage == CaptureLatencyStage.CALLABLE_START) {
                timeline.points.remove(CaptureLatencyStage.CALLABLE_END)
            }
            timeline.lastUpdatedElapsedRealtimeMillis = maxOf(
                timeline.lastUpdatedElapsedRealtimeMillis,
                maintenanceElapsedRealtimeMillis
            )
            timeline.points[stage] = Point(atElapsedRealtimeMillis, outcome)

            if (stage == CaptureLatencyStage.QUICK_EDIT_SHOWN) {
                buildSummary(correlationId, timeline).also {
                    timelines.remove(correlationId)
                }
            } else {
                null
            }
        }

        if (detailed) {
            runCatching {
                emit(
                    CaptureLatencyLogLevel.DEBUG,
                    "correlationId=$correlationId" +
                        " stage=${stage.wireName}" +
                        " elapsedRealtimeMs=$atElapsedRealtimeMillis" +
                        " outcome=${outcome.wireName}"
                )
            }
        }
        summary?.let { message ->
            runCatching { emit(CaptureLatencyLogLevel.INFO, message) }
        }
    }

    private fun buildSummary(correlationId: String, timeline: Timeline): String {
        val points = timeline.points
        return buildString {
            append("correlationId=")
            append(correlationId)
            append(" stage=quick_edit_shown")
            append(" elapsedRealtimeMs=")
            append(points.getValue(CaptureLatencyStage.QUICK_EDIT_SHOWN).elapsedRealtimeMillis)
            append(" recordedStages=")
            append(points.size)
            appendDuration(
                "notificationToJournalMs",
                points[CaptureLatencyStage.NOTIFICATION_RECEIVED],
                points[CaptureLatencyStage.JOURNAL_PERSISTED]
            )
            appendDuration(
                "callableMs",
                points[CaptureLatencyStage.CALLABLE_START],
                points[CaptureLatencyStage.CALLABLE_END]
            )
            appendDuration(
                "callableEndToFollowUpMs",
                points[CaptureLatencyStage.CALLABLE_END],
                points[CaptureLatencyStage.FOLLOW_UP_PERSISTED]
            )
            appendDuration(
                "followUpToLaunchMs",
                points[CaptureLatencyStage.FOLLOW_UP_PERSISTED],
                points[CaptureLatencyStage.QUICK_EDIT_LAUNCH]
            )
            appendDuration(
                "launchToShownMs",
                points[CaptureLatencyStage.QUICK_EDIT_LAUNCH],
                points[CaptureLatencyStage.QUICK_EDIT_SHOWN]
            )
            appendDuration(
                "totalMs",
                points[CaptureLatencyStage.NOTIFICATION_RECEIVED],
                points[CaptureLatencyStage.QUICK_EDIT_SHOWN]
            )
        }
    }

    private fun StringBuilder.appendDuration(
        name: String,
        start: Point?,
        end: Point?
    ) {
        if (start == null || end == null) return
        val duration = end.elapsedRealtimeMillis - start.elapsedRealtimeMillis
        if (duration < 0L) return
        append(' ')
        append(name)
        append('=')
        append(duration)
    }

    private fun prune(nowElapsedRealtimeMillis: Long) {
        val iterator = timelines.entries.iterator()
        while (iterator.hasNext()) {
            val lastUpdated = iterator.next().value.lastUpdatedElapsedRealtimeMillis
            val age = nowElapsedRealtimeMillis - lastUpdated
            if (age < 0L || age > maxTraceAgeMillis) {
                iterator.remove()
            }
        }
    }

    private fun evictOldestIfNeeded() {
        while (timelines.size >= maxActiveTraces) {
            val iterator = timelines.entries.iterator()
            if (!iterator.hasNext()) return
            iterator.next()
            iterator.remove()
        }
    }

    private fun correlationIdFor(observationId: String): String? {
        if (
            observationId.length !in 1..MAX_OBSERVATION_ID_LENGTH ||
            !observationId.first().isAsciiLetterOrDigit() ||
            !observationId.drop(1).all { character ->
                character.isAsciiLetterOrDigit() ||
                    character == '.' ||
                    character == '_' ||
                    character == ':' ||
                    character == '-'
            }
        ) return null

        return runCatching {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(observationId.toByteArray(Charsets.UTF_8))
            buildString(CORRELATION_ID_LENGTH) {
                repeat(CORRELATION_ID_LENGTH / 2) { index ->
                    val byte = digest[index].toInt() and 0xff
                    append(HEX_DIGITS[byte ushr 4])
                    append(HEX_DIGITS[byte and 0x0f])
                }
            }
        }.getOrNull()
    }

    private fun Char.isAsciiLetterOrDigit(): Boolean =
        this in 'a'..'z' || this in 'A'..'Z' || this in '0'..'9'

    companion object {
        private const val MAX_OBSERVATION_ID_LENGTH = 128
        private const val CORRELATION_ID_LENGTH = 16
        private const val HEX_DIGITS = "0123456789abcdef"
        private const val DEFAULT_MAX_ACTIVE_TRACES = 128
        private const val DEFAULT_MAX_TRACE_AGE_MILLIS = 6L * 60L * 60L * 1_000L
    }
}
