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

    fun shouldForward(
        source: RegisteredNotificationSource,
        title: String,
        fullText: String
    ): Boolean = when (source) {
        RegisteredNotificationSource.SMS ->
            smsFinancialMarker.containsMatchIn(fullText) &&
                smsMoneyMarker.containsMatchIn(fullText) &&
                smsTransactionMarker.containsMatchIn(fullText)
        RegisteredNotificationSource.CITY_GAS_BILL ->
            cityGasMarker.containsMatchIn(fullText) && fullText.contains("원")
        RegisteredNotificationSource.TOSS_BANK -> !tossWalkingTitlePattern.matches(title.trim())
        else -> true
    }
}
