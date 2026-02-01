package com.household.account.parser

/**
 * 토스뱅크 카카오톡 알림 파싱
 *
 * 출금 알림 형식:
 * [출금 안내]
 * 망고네 생활비 계좌 모임통장에서
 * 10,000원이 출금됐어요.
 * 02/01 21:39
 * 이진선
 * 거래한 모임원 : 이*선
 */
object TossKakaoParser {

    data class WithdrawalInfo(
        val amount: Int,
        val date: String,      // MM/DD
        val time: String,      // HH:mm
        val memberName: String // 거래한 모임원
    )

    /**
     * 출금 알림 파싱
     * @return 출금 정보 또는 null (파싱 실패 시)
     */
    fun parseWithdrawal(text: String): WithdrawalInfo? {
        try {
            // [출금 안내] + 망고네 생활비 계좌 포함 확인
            if (!text.contains("[출금 안내]") || !text.contains("망고네 생활비 계좌")) {
                return null
            }

            // 금액 파싱: "10,000원이 출금됐어요" 또는 "1원이 출금됐어요"
            val amountRegex = """([0-9,]+)원이 출금됐어요""".toRegex()
            val amountMatch = amountRegex.find(text) ?: return null
            val amount = amountMatch.groupValues[1].replace(",", "").toIntOrNull() ?: return null

            // 날짜/시간 파싱: "02/01 21:39"
            val dateTimeRegex = """(\d{2}/\d{2})\s+(\d{2}:\d{2})""".toRegex()
            val dateTimeMatch = dateTimeRegex.find(text)
            val date = dateTimeMatch?.groupValues?.get(1) ?: ""
            val time = dateTimeMatch?.groupValues?.get(2) ?: ""

            // 이름 파싱: 날짜/시간 다음 줄에 있는 이름 (거래한 모임원 전)
            // "02/01 21:39\n이진선\n거래한 모임원"
            val nameRegex = """\d{2}:\d{2}\s*\n\s*([가-힣]+)\s*\n""".toRegex()
            val nameMatch = nameRegex.find(text)
            val memberName = nameMatch?.groupValues?.get(1)?.trim() ?: ""

            return WithdrawalInfo(
                amount = amount,
                date = date,
                time = time,
                memberName = memberName
            )
        } catch (e: Exception) {
            return null
        }
    }

    /**
     * 토스뱅크 카카오톡 알림인지 확인
     */
    fun isTossBankMessage(title: String, sender: String): Boolean {
        return title.contains("토스뱅크") || sender.contains("토스뱅크")
    }
}
