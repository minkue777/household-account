package com.household.account.parser

/**
 * MG새마을금고 SMS 파싱
 *
 * 입금 알림 형식:
 * [Web발신]
 * <새마을금고>900326**6 이민규
 * 입금10,000 잔액23,536,829원 02/01 21:34
 */
object MGSaemaeulParser {

    data class DepositInfo(
        val amount: Int,
        val balance: Int,
        val date: String,      // MM/DD
        val time: String,      // HH:mm
        val accountHolder: String  // 예금주 이름
    )

    /**
     * 입금 알림 파싱
     * @return 입금 정보 또는 null (파싱 실패 시)
     */
    fun parseDeposit(text: String): DepositInfo? {
        try {
            // 새마을금고 메시지인지 확인
            if (!text.contains("새마을금고")) {
                return null
            }

            // 입금 메시지인지 확인
            if (!text.contains("입금")) {
                return null
            }

            // 출금 메시지는 제외
            if (text.contains("출금")) {
                return null
            }

            // 금액 파싱: "입금10,000" 또는 "입금1"
            val amountRegex = """입금([0-9,]+)""".toRegex()
            val amountMatch = amountRegex.find(text) ?: return null
            val amount = amountMatch.groupValues[1].replace(",", "").toIntOrNull() ?: return null

            // 잔액 파싱: "잔액23,536,829원"
            val balanceRegex = """잔액([0-9,]+)원""".toRegex()
            val balanceMatch = balanceRegex.find(text)
            val balance = balanceMatch?.groupValues?.get(1)?.replace(",", "")?.toIntOrNull() ?: 0

            // 날짜/시간 파싱: "02/01 21:34"
            val dateTimeRegex = """(\d{2}/\d{2})\s+(\d{2}:\d{2})""".toRegex()
            val dateTimeMatch = dateTimeRegex.find(text)
            val date = dateTimeMatch?.groupValues?.get(1) ?: ""
            val time = dateTimeMatch?.groupValues?.get(2) ?: ""

            // 예금주 이름 파싱: "<새마을금고>900326**6 이민규"
            val nameRegex = """<새마을금고>\d+\*+\d+\s+([가-힣]+)""".toRegex()
            val nameMatch = nameRegex.find(text)
            val accountHolder = nameMatch?.groupValues?.get(1)?.trim() ?: ""

            return DepositInfo(
                amount = amount,
                balance = balance,
                date = date,
                time = time,
                accountHolder = accountHolder
            )
        } catch (e: Exception) {
            return null
        }
    }

    /**
     * MG새마을금고 메시지인지 확인
     */
    fun isMGSaemaeulMessage(sender: String, text: String): Boolean {
        return sender.contains("새마을금고") ||
               sender.contains("1599-9000") ||
               text.contains("새마을금고")
    }
}
