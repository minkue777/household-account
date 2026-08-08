package com.household.account.paymentcapture

/**
 * 문자·대화 앱의 무관한 원문이 서버로 전송되지 않게 막는 admission policy입니다.
 * 거래 필드를 해석하거나 공급자 parser를 선택하는 책임은 서버에만 있습니다.
 */
object RawNotificationForwardingPolicy {
    private val tossWalkingTitlePattern = Regex("""^\d[\d,]*\s*걸음$""")
    private val smsFinancialMarker = Regex(
        """(카드|KB국민|NH|농협|네이버페이|토스뱅크|카카오페이|온누리|페이북|비씨|BC|삼성\s*\d{4}|삼성카드|롯데|지역화폐|화성페이|대전사랑카드|온통대전|여민전|관리비)""",
        RegexOption.IGNORE_CASE
    )
    private val smsMoneyMarker = Regex("""\d[\d,]*\s*원""")
    private val smsTransactionMarker = Regex("""(승인|취소|결제|사용|납부|잔액|캐시백)""")
    private val cityGasMarker = Regex("""도시가스(?:\s*요금)?\s*청구""")
    private val kakaoCardEventMarker = Regex(
        """(?:KB(?:국민)?(?:카드)?(?:신용|체크)?|NH(?:농협)?(?:카드)?|농협(?:카드)?|삼성(?:카드)?|롯데(?:카드)?|신한(?:카드)?|현대(?:카드)?|하나(?:카드)?|우리(?:카드)?|IBK(?:기업)?(?:카드)?|BC(?:카드)?|비씨(?:카드)?|씨티(?:카드)?)\s*\(?[0-9*xX＊]{4}\)?\s*(?:승인(?:\s*취소)?|취소)""",
        RegexOption.IGNORE_CASE
    )
    private val kakaoCardDateTimeMarker = Regex(
        """(?:0[1-9]|1[0-2])/(?:0[1-9]|[12]\d|3[01])\s+(?:[01]\d|2[0-3]):[0-5]\d(?=$|[ \t\r\n])"""
    )
    private val kakaoPromotionMarker = Regex(
        """(?:^|[\s\[(])광고(?:$|[\s\]):：])|신청\s*마감|이벤트\s*(?:안내|응모)|쿠폰\s*(?:받기|도착|안내)|혜택\s*(?:안내|받기)""",
        RegexOption.IGNORE_CASE
    )

    fun shouldForward(
        source: RegisteredNotificationSource,
        title: String,
        candidateText: String
    ): Boolean = when (source) {
        RegisteredNotificationSource.SMS ->
            smsFinancialMarker.containsMatchIn(candidateText) &&
                smsMoneyMarker.containsMatchIn(candidateText) &&
                smsTransactionMarker.containsMatchIn(candidateText)
        RegisteredNotificationSource.KAKAO_TALK_FINANCIAL ->
            classifyKakaoFinancialCandidate(candidateText) != null
        RegisteredNotificationSource.TOSS_BANK -> !tossWalkingTitlePattern.matches(title.trim())
        else -> true
    }

    fun classifyKakaoFinancialCandidate(
        candidateText: String
    ): KakaoFinancialCandidateKind? = when {
        isStrictKakaoCardCandidate(candidateText) -> KakaoFinancialCandidateKind.CARD
        isStrictCityGasCandidate(candidateText) -> KakaoFinancialCandidateKind.CITY_GAS
        else -> null
    }

    private fun isStrictCityGasCandidate(fullText: String): Boolean =
        cityGasMarker.containsMatchIn(fullText) && smsMoneyMarker.containsMatchIn(fullText)

    private fun isStrictKakaoCardCandidate(fullText: String): Boolean =
        kakaoCardEventMarker.containsMatchIn(fullText) &&
            smsMoneyMarker.containsMatchIn(fullText) &&
            kakaoCardDateTimeMarker.containsMatchIn(fullText) &&
            !kakaoPromotionMarker.containsMatchIn(fullText)
}

enum class KakaoFinancialCandidateKind {
    CARD,
    CITY_GAS
}
