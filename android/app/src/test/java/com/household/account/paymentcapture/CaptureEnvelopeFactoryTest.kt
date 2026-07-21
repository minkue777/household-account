package com.household.account.paymentcapture

import com.household.account.data.Expense
import com.household.account.parser.ExpenseEventType
import com.household.account.parser.LocalCurrencyBalanceResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureEnvelopeFactoryTest {
    @Test
    fun `도시가스 외 등록 source의 승인과 취소는 항상 card evidence를 가진다`() {
        RegisteredNotificationSource.entries
            .filterNot { it == RegisteredNotificationSource.CITY_GAS_BILL }
            .forEach { source ->
                listOf(ExpenseEventType.APPROVAL, ExpenseEventType.CANCELLATION).forEach { eventType ->
                    val envelope = CaptureEnvelopeFactory.create(
                        packageName = PaymentSourceRegistry.registeredPackages()
                            .first { PaymentSourceRegistry.resolve(it) == source },
                        source = source,
                        postedAtMillis = 1_768_787_260_000L,
                        rawNotificationText = "등록 알림",
                        expense = Expense(
                            date = "2026-01-19",
                            time = "11:01",
                            merchant = "가맹점",
                            amount = 5_000,
                            cardLastFour = "${source.companyLabel}(1234)"
                        ),
                        eventType = eventType,
                        balance = null
                    )

                    assertNotNull("$source $eventType", envelope?.paymentObservation?.cardEvidence)
                }
            }
    }

    @Test
    fun `지원 enum 밖의 currency type은 balance branch를 만들지 않는다`() {
        val envelope = CaptureEnvelopeFactory.create(
            packageName = "com.kbcard.cxh.appcard",
            source = RegisteredNotificationSource.KB,
            postedAtMillis = 1_768_787_260_000L,
            rawNotificationText = "알 수 없는 화폐 잔액",
            expense = null,
            eventType = null,
            balance = LocalCurrencyBalanceResult(10_000, "unknown-currency")
        )

        assertEquals(null, envelope)
    }

    @Test
    fun `승인과 잔액을 독립 branch로 가진 원문 없는 envelope를 만든다`() {
        val raw = "경기지역화폐 5,000원 결제\n가맹점 B\n잔액 83,000원"
        val envelope = CaptureEnvelopeFactory.create(
            packageName = "gov.gyeonggi.ggcard",
            source = RegisteredNotificationSource.GYEONGGI_LOCAL_CURRENCY,
            postedAtMillis = 1_768_787_260_000L,
            rawNotificationText = raw,
            expense = Expense(
                date = "2026-01-19",
                time = "11:01",
                merchant = "가맹점 B",
                amount = 5_000,
                cardLastFour = "경기지역화폐(5678)"
            ),
            eventType = ExpenseEventType.APPROVAL,
            balance = LocalCurrencyBalanceResult(83_000, "경기지역화폐")
        )

        assertNotNull(envelope)
        requireNotNull(envelope)
        assertEquals("approval", envelope.paymentObservation?.observationType)
        assertEquals("gyeonggi", envelope.paymentObservation?.localCurrencyType)
        assertEquals(83_000, envelope.balanceObservation?.balanceInWon)
        assertTrue(envelope.rawPayloadHash.matches(Regex("sha256:[a-f0-9]{64}")))

        val wire = envelope.toMap().toString()
        assertFalse(wire.contains(raw))
        assertFalse(wire.contains("잔액 83,000원"))
        assertTrue(wire.contains("가맹점 B"))
    }

    @Test
    fun `최초 생성한 observation ID는 모든 branch의 안정 key가 된다`() {
        fun create() = CaptureEnvelopeFactory.create(
            packageName = "com.kbcard.cxh.appcard",
            source = RegisteredNotificationSource.KB,
            postedAtMillis = 1_768_787_260_000L,
            rawNotificationText = "KB국민카드1234 승인 12,000원 01/19 10:05 가맹점 A",
            expense = Expense(
                date = "2026-01-19",
                time = "10:05",
                merchant = "가맹점 A",
                amount = 12_000,
                cardLastFour = "국민(1234)"
            ),
            eventType = ExpenseEventType.APPROVAL,
            balance = null,
            observationId = "observation.android.fixed001"
        )

        assertEquals(create()?.observationId, create()?.observationId)
        assertEquals(
            create()?.paymentObservation?.branchId,
            create()?.paymentObservation?.branchId
        )
    }
}
