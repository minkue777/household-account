package com.household.account.parser

import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PayboocISPParserTest {

    @Test
    fun parsesInlineApprovalFormat() {
        val result = PayboocISPParser.parse(
            """
            국민행복카드(신용)농협(3448)
            네이버페이 에서 198,022원 사용
            [ 06월 19일 누적금액은? ]
            """.trimIndent(),
            postedAtMillis = localMillis(2026, 6, 19, 15, 40)
        )

        assertTrue(result.success)
        assertEquals(ExpenseEventType.APPROVAL, result.eventType)

        val expense = requireNotNull(result.expense)
        assertEquals("2026-06-19", expense.date)
        assertEquals("15:40", expense.time)
        assertEquals("네이버페이", expense.merchant)
        assertEquals(198022, expense.amount)
        assertEquals("농협(3448)", expense.cardLastFour)
    }

    @Test
    fun parsesInlineCancellationFormat() {
        val result = PayboocISPParser.parse(
            """
            국민행복카드(신용)농협(3448)
            [매출취소]주식회사 에스알 에서 28,800원(06/15기준)
            """.trimIndent(),
            postedAtMillis = localMillis(2026, 6, 16, 9, 9)
        )

        assertTrue(result.success)
        assertEquals(ExpenseEventType.CANCELLATION, result.eventType)

        val expense = requireNotNull(result.expense)
        assertEquals("2026-06-16", expense.date)
        assertEquals("09:09", expense.time)
        assertEquals("주식회사 에스알", expense.merchant)
        assertEquals(28800, expense.amount)
        assertEquals("농협(3448)", expense.cardLastFour)
    }

    @Test
    fun keepsSeparatedMerchantAndAmountFormat() {
        val result = PayboocISPParser.parse(
            """
            국민행복카드(신용)농협(3448)
            투썸플레이스 대전용문점에서
            21,400원 사용
            """.trimIndent(),
            postedAtMillis = localMillis(2026, 5, 18, 9, 8)
        )

        assertTrue(result.success)
        assertEquals(ExpenseEventType.APPROVAL, result.eventType)

        val expense = assertNotNull(result.expense).let { result.expense!! }
        assertEquals("2026-05-18", expense.date)
        assertEquals("09:08", expense.time)
        assertEquals("투썸플레이스 대전용문점", expense.merchant)
        assertEquals(21400, expense.amount)
        assertEquals("농협(3448)", expense.cardLastFour)
    }

    private fun localMillis(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int
    ): Long {
        return LocalDateTime.of(year, month, day, hour, minute)
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()
    }
}
