package com.household.account.paymentcapture

data class StructuredNotificationMessage(
    val text: String,
    val postedAtMillis: Long
)

data class RawNotificationSnapshot(
    val postedAtMillis: Long,
    val title: String,
    val text: String,
    val bigText: String,
    val textLines: List<String>,
    val structuredMessages: List<StructuredNotificationMessage> = emptyList()
)

data class RawNotificationCandidate(
    val postedAtMillis: Long,
    val origin: RawNotificationCandidateOrigin,
    val title: String,
    val text: String,
    val bigText: String,
    val textLines: List<String>,
    val bodyText: String,
    val fullText: String
)

enum class RawNotificationCandidateOrigin {
    STANDARD,
    KAKAO_STRUCTURED_MESSAGE,
    KAKAO_FALLBACK
}

/**
 * OS 알림 하나를 서버에 독립 제출할 원문 후보로 바꿉니다.
 * 카카오톡 MessagingStyle 이력은 누적 본문으로 합치지 않고 메시지별 후보로 유지합니다.
 */
object RawNotificationCandidateFactory {
    private val kakaoConversationBlockBoundary = Regex(
        """(?m)^\[[^\]\r\n]{1,80}\][ \t]+\[(?:오전|오후)[ \t]+(?:1[0-2]|0?[1-9]):[0-5]\d\]"""
    )

    fun create(
        source: RegisteredNotificationSource?,
        snapshot: RawNotificationSnapshot
    ): List<RawNotificationCandidate> =
        if (source == RegisteredNotificationSource.KAKAO_TALK_FINANCIAL) {
            createKakaoCandidates(snapshot)
        } else {
            listOf(candidateFromSnapshot(snapshot)).filter { it.fullText.isNotEmpty() }
        }

    private fun createKakaoCandidates(
        snapshot: RawNotificationSnapshot
    ): List<RawNotificationCandidate> {
        val structured = snapshot.structuredMessages
            .filter { it.text.isNotBlank() }
            .distinctBy { message -> message.postedAtMillis to message.text }
            .map { message ->
                candidate(
                    postedAtMillis = message.postedAtMillis.takeIf { it > 0L }
                        ?: snapshot.postedAtMillis,
                    origin = RawNotificationCandidateOrigin.KAKAO_STRUCTURED_MESSAGE,
                    title = snapshot.title,
                    text = message.text
                )
            }
        if (structured.isNotEmpty()) return structured

        val candidateTiers = buildList {
            if (snapshot.text.isNotBlank()) {
                add(candidatesFromSelectedBody(snapshot, SelectedBody.Text(snapshot.text)))
            }
            if (snapshot.bigText.isNotBlank()) {
                add(candidatesFromSelectedBody(snapshot, SelectedBody.BigText(snapshot.bigText)))
            }
            if (snapshot.textLines.isNotEmpty()) {
                add(
                    candidatesFromSelectedBody(
                        snapshot,
                        SelectedBody.TextLines(snapshot.textLines.joinToString("\n"))
                    )
                )
            }
        }
        return candidateTiers.firstOrNull { tier ->
            tier.any { candidate ->
                RawNotificationForwardingPolicy.shouldForward(
                    RegisteredNotificationSource.KAKAO_TALK_FINANCIAL,
                    title = "",
                    candidateText = candidate.bodyText
                )
            }
        } ?: emptyList()
    }

    private fun candidatesFromSelectedBody(
        snapshot: RawNotificationSnapshot,
        selectedBody: SelectedBody
    ): List<RawNotificationCandidate> =
        splitKakaoConversationBlocks(selectedBody.value).map { block ->
            when (selectedBody) {
                is SelectedBody.Text -> candidate(
                    postedAtMillis = snapshot.postedAtMillis,
                    origin = RawNotificationCandidateOrigin.KAKAO_FALLBACK,
                    title = snapshot.title,
                    text = block
                )
                is SelectedBody.BigText -> candidate(
                    postedAtMillis = snapshot.postedAtMillis,
                    origin = RawNotificationCandidateOrigin.KAKAO_FALLBACK,
                    title = snapshot.title,
                    bigText = block
                )
                is SelectedBody.TextLines -> candidate(
                    postedAtMillis = snapshot.postedAtMillis,
                    origin = RawNotificationCandidateOrigin.KAKAO_FALLBACK,
                    title = snapshot.title,
                    textLines = block.lines()
                        .map(String::trim)
                        .filter(String::isNotEmpty)
                )
            }
        }.filter { it.fullText.isNotEmpty() }

    private fun splitKakaoConversationBlocks(value: String): List<String> {
        val starts = kakaoConversationBlockBoundary.findAll(value)
            .map { it.range.first }
            .toList()
        if (starts.isEmpty()) return listOf(value.trim()).filter(String::isNotEmpty)

        return starts.mapIndexedNotNull { index, start ->
            val end = starts.getOrNull(index + 1) ?: value.length
            value.substring(start, end).trim().takeIf(String::isNotEmpty)
        }
    }

    private fun candidateFromSnapshot(
        snapshot: RawNotificationSnapshot
    ): RawNotificationCandidate = candidate(
        postedAtMillis = snapshot.postedAtMillis,
        title = snapshot.title,
        text = snapshot.text,
        bigText = snapshot.bigText,
        textLines = snapshot.textLines
    )

    private fun candidate(
        postedAtMillis: Long,
        origin: RawNotificationCandidateOrigin = RawNotificationCandidateOrigin.STANDARD,
        title: String,
        text: String = "",
        bigText: String = "",
        textLines: List<String> = emptyList()
    ): RawNotificationCandidate {
        val bodyText = when {
            textLines.isNotEmpty() -> textLines.joinToString("\n")
            bigText.isNotBlank() -> bigText
            text.isNotBlank() -> text
            else -> ""
        }
        val fullText = listOf(title, bodyText)
            .filter(String::isNotBlank)
            .joinToString("\n")
            .trim()
        return RawNotificationCandidate(
            postedAtMillis = postedAtMillis,
            origin = origin,
            title = title,
            text = text,
            bigText = bigText,
            textLines = textLines,
            bodyText = bodyText,
            fullText = fullText
        )
    }

    private sealed interface SelectedBody {
        val value: String

        data class Text(override val value: String) : SelectedBody
        data class BigText(override val value: String) : SelectedBody
        data class TextLines(override val value: String) : SelectedBody
    }
}
