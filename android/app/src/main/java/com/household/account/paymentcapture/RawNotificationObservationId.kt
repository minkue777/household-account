package com.household.account.paymentcapture

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId

/**
 * 카카오 후보의 root idempotency key와 raw payload를 하나의 정규화 결과에서 만듭니다.
 * 같은 observation id가 만들어지면 서버에 보낼 raw payload도 반드시 같습니다.
 */
object RawNotificationObservationId {
    private const val CONTRACT_PREFIX = "kakao-message-observation.v1"
    private const val OBSERVATION_PREFIX = "observation.android.kakao.v1."
    private val seoulZoneId = ZoneId.of("Asia/Seoul")
    private val kakaoFallbackTransportPrefix = Regex(
        """^\[[^\]\r\n]{1,80}\][ \t]+\[(오전|오후)[ \t]+(1[0-2]|0?[1-9]):([0-5]\d)\]"""
    )
    private val hexDigits = "0123456789abcdef".toCharArray()

    fun forKakaoCandidate(
        packageName: String,
        candidate: RawNotificationCandidate
    ): String = observationId(packageName, canonicalize(candidate))

    fun createKakaoEnvelope(
        packageName: String,
        candidate: RawNotificationCandidate
    ): RawNotificationEnvelopeV1 {
        val canonical = canonicalize(candidate)
        return RawNotificationEnvelopeV1.create(
            packageName = packageName,
            postedAtMillis = canonical.postedAtMillis,
            title = canonical.title,
            text = canonical.bodyText,
            bigText = "",
            textLines = emptyList(),
            observationId = observationId(packageName, canonical)
        )
    }

    private fun canonicalize(candidate: RawNotificationCandidate): KakaoRawProjection {
        val kind = checkNotNull(
            RawNotificationForwardingPolicy.classifyKakaoFinancialCandidate(
                candidate.bodyText
            )
        ) { "Kakao candidate must pass financial admission before projection" }
        val originalPostedAtMillis = candidate.postedAtMillis.coerceAtLeast(0L)
        val postedAtMillis = if (
            kind == KakaoFinancialCandidateKind.CARD &&
            candidate.origin == RawNotificationCandidateOrigin.KAKAO_FALLBACK
        ) {
            fallbackTransportPostedAtMillis(
                candidate.bodyText,
                originalPostedAtMillis
            ) ?: originalPostedAtMillis
        } else {
            originalPostedAtMillis
        }
        return KakaoRawProjection(
            kind = kind,
            postedAtMillis = postedAtMillis,
            title = if (kind == KakaoFinancialCandidateKind.CARD) "" else candidate.title,
            bodyText = candidate.bodyText
        )
    }

    private fun fallbackTransportPostedAtMillis(
        bodyText: String,
        snapshotPostedAtMillis: Long
    ): Long? {
        val match = kakaoFallbackTransportPrefix.find(bodyText) ?: return null
        val hour12 = match.groupValues[2].toInt()
        val hour24 = when (match.groupValues[1]) {
            "오전" -> if (hour12 == 12) 0 else hour12
            "오후" -> if (hour12 == 12) 12 else hour12 + 12
            else -> return null
        }
        val minute = match.groupValues[3].toInt()
        return runCatching {
            Instant.ofEpochMilli(snapshotPostedAtMillis)
                .atZone(seoulZoneId)
                .toLocalDate()
                .atTime(hour24, minute)
                .atZone(seoulZoneId)
                .toInstant()
                .toEpochMilli()
        }.getOrNull()
    }

    private fun observationId(
        packageName: String,
        canonical: KakaoRawProjection
    ): String {
        val digest = MessageDigest.getInstance("SHA-256")
        listOf(
            CONTRACT_PREFIX,
            packageName,
            canonical.kind.name,
            canonical.postedAtMillis.toString(),
            canonical.title,
            canonical.bodyText
        ).forEach { field ->
            val bytes = field.toByteArray(StandardCharsets.UTF_8)
            digest.update(ByteBuffer.allocate(Int.SIZE_BYTES).putInt(bytes.size).array())
            digest.update(bytes)
        }
        return OBSERVATION_PREFIX + digest.digest().toLowerHex()
    }

    private data class KakaoRawProjection(
        val kind: KakaoFinancialCandidateKind,
        val postedAtMillis: Long,
        val title: String,
        val bodyText: String
    )

    private fun ByteArray.toLowerHex(): String = buildString(size * 2) {
        this@toLowerHex.forEach { byte ->
            val value = byte.toInt() and 0xff
            append(hexDigits[value ushr 4])
            append(hexDigits[value and 0x0f])
        }
    }
}
