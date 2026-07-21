package com.household.account.parser

import com.google.gson.Gson
import com.household.account.paymentcapture.PaymentSourceRegistry
import com.household.account.util.CardLabelFormatter
import java.io.File
import java.time.OffsetDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidProviderParserCompatibilityTest {
    private val gson = Gson()
    private val clockNowMillis = OffsetDateTime.parse("2026-07-21T01:02:00+09:00")
        .toInstant()
        .toEpochMilli()

    @Test
    fun everyLegacyParserConsumesTheSharedGoldenContract() {
        val fixture = readFixture<ProviderFixture>(
            "payment-capture/android-provider-parser-golden.v1.json"
        )

        fixture.cases.forEach { case ->
            val source = PaymentSourceRegistry.resolve(case.source.packageName)
            assertNotNull("${case.caseId}: registered package", source)
            assertEquals("${case.caseId}: parser id", case.source.parserId, source?.parserId)

            val fullText = case.raw.fullText()
            val postedAtMillis = case.raw.postedAt?.let {
                OffsetDateTime.parse(it).toInstant().toEpochMilli()
            }
            val result = parse(
                case.source.parserId,
                fullText,
                postedAtMillis,
                clockNowMillis
            )
            val balance = parseBalance(case.source.parserId, fullText)

            assertCase(case, result, balance)
        }
    }

    @Test
    fun cityGasParserConsumesTheSharedGoldenContract() {
        val fixture = readFixture<CityGasFixture>(
            "payment-capture/city-gas-parser-golden.v1.json"
        )

        fixture.cases.forEach { case ->
            val observedAt = OffsetDateTime.parse(case.raw.observedAtSeoul)
                .toInstant()
                .toEpochMilli()
            val fullText = listOfNotNull(case.raw.title, case.raw.body)
                .filter(String::isNotBlank)
                .joinToString("\n")
            val result = CityGasBillParser.parse(
                fullText,
                postedAtMillis = observedAt,
                clockNowMillis = observedAt
            )

            if (case.expected.kind == "Parsed") {
                assertTrue("${case.caseId}: parsed", result.success)
                val expense = requireNotNull(result.expense)
                assertEquals(case.expected.amountInWon, expense.amount)
                assertEquals(case.expected.accountingDate, expense.date)
                assertEquals("FIXED", expense.category)
                if (case.expected.memoPolicy == "Empty") {
                    assertTrue(expense.memo.isBlank())
                } else {
                    assertTrue(expense.memo.contains("도시가스요금 청구서"))
                    val expectedMonth = case.expected.billingMonth
                        ?.substringAfter("-")
                        ?.toIntOrNull()
                    assertEquals("${expectedMonth}월 도시가스요금", expense.merchant)
                }
            } else {
                assertFalse("${case.caseId}: ignored", result.success)
                assertNull(result.expense)
            }
        }
    }

    @Test
    fun occurrenceYearPolicyConsumesTheSharedContract() {
        val fixture = readFixture<OccurrenceFixture>(
            "payment-capture/payment-occurrence-year.v1.json"
        )

        fixture.cases.forEach { case ->
            val receivedAtMillis = OffsetDateTime.parse(case.input.receivedAt)
                .toInstant()
                .toEpochMilli()
            val result = runCatching {
                ParserTimeSupport.resolveOccurrence(
                    "%02d/%02d".format(case.input.month, case.input.day),
                    "%02d:%02d".format(case.input.hour, case.input.minute),
                    postedAtMillis = receivedAtMillis,
                    clockNowMillis = receivedAtMillis
                )
            }

            if (case.expected.kind == "success") {
                val occurrence = result.getOrThrow()
                assertEquals(
                    case.caseId,
                    case.expected.occurredLocalDateTime,
                    "${occurrence.date}T${occurrence.time}"
                )
            } else {
                assertTrue("${case.caseId}: parse failure", result.isFailure)
            }
        }
    }

    private fun assertCase(
        case: ProviderCase,
        result: ParseResult,
        balance: LocalCurrencyBalanceResult?
    ) {
        val expectedPayment = case.expected.payment
        if (expectedPayment == null) {
            assertFalse("${case.caseId}: no payment", result.success)
            assertNull("${case.caseId}: no expense", result.expense)
        } else {
            assertTrue("${case.caseId}: parsed payment", result.success)
            val expense = requireNotNull(result.expense)
            assertEquals(case.caseId, expectedPayment.amountInWon, expense.amount)
            assertEquals(case.caseId, expectedPayment.occurredLocalDate, expense.date)
            assertEquals(case.caseId, expectedPayment.occurredLocalTime, expense.time)
            assertEquals(case.caseId, expectedPayment.merchant, expense.merchant)
            assertEquals(
                case.caseId,
                expectedPayment.cardCompany,
                CardLabelFormatter.extractCardLabel(expense.cardLastFour)
            )
            assertEquals(
                case.caseId,
                expectedPayment.maskedCardToken?.lowercase(),
                CardLabelFormatter.extractCardToken(expense.cardLastFour)
            )
            assertEquals(
                case.caseId,
                expectedPayment.type,
                if (result.eventType == ExpenseEventType.CANCELLATION) {
                    "cancellation"
                } else {
                    "approval"
                }
            )
        }

        val expectedBalance = case.expected.balance
        if (expectedBalance == null) {
            assertTrue(
                "${case.caseId}: no balance",
                balance == null || balance.balance == null
            )
        } else {
            assertEquals(case.caseId, expectedBalance.amountInWon, balance?.balance)
        }
    }

    private fun parse(
        parserId: String,
        fullText: String,
        postedAtMillis: Long?,
        clockNowMillis: Long
    ): ParseResult = when (parserId) {
        "kb-card-parser" -> KBCardParser.parse(
            fullText,
            postedAtMillis = postedAtMillis,
            clockNowMillis = clockNowMillis
        )
        "nh-pay-parser" -> NHPayParser.parse(
            fullText,
            postedAtMillis = postedAtMillis,
            clockNowMillis = clockNowMillis
        )
        "naver-pay-parser" -> NaverPayParser.parse(fullText, postedAtMillis, clockNowMillis)
        "toss-bank-parser" -> TossBankParser.parse(fullText, postedAtMillis, clockNowMillis)
        "kakao-pay-parser" -> KakaoPayParser.parse(fullText, postedAtMillis, clockNowMillis)
        "digital-onnuri-parser" -> DigitalOnnuriParser.parse(fullText, postedAtMillis, clockNowMillis)
        "paybooc-isp-parser" -> PayboocISPParser.parse(fullText, postedAtMillis, clockNowMillis)
        "sms-card-message-parser" -> SmsNotificationParser.parse(
            fullText,
            postedAtMillis,
            clockNowMillis
        )
        "samsung-card-parser" -> SamsungCardParser.parse(
            fullText,
            postedAtMillis = postedAtMillis,
            clockNowMillis = clockNowMillis
        )
        "lotte-card-parser" -> LotteCardParser.parse(
            fullText,
            postedAtMillis = postedAtMillis,
            clockNowMillis = clockNowMillis
        )
        "gyeonggi-local-currency-parser" -> GyeonggiLocalCurrencyParser.parse(
            fullText,
            postedAtMillis,
            clockNowMillis
        )
        "daejeon-local-currency-parser" -> DaejeonLocalCurrencyParser.parse(
            fullText,
            postedAtMillis,
            clockNowMillis
        )
        "sejong-local-currency-parser" -> SejongLocalCurrencyParser.parse(
            fullText,
            postedAtMillis,
            clockNowMillis
        )
        else -> error("Unsupported fixture parser: $parserId")
    }

    private fun parseBalance(
        parserId: String,
        fullText: String
    ): LocalCurrencyBalanceResult? = when (parserId) {
        "gyeonggi-local-currency-parser" -> GyeonggiLocalCurrencyParser.parseBalance(fullText)
        "daejeon-local-currency-parser" -> DaejeonLocalCurrencyParser.parseBalance(fullText)
        "sejong-local-currency-parser" -> SejongLocalCurrencyParser.parseBalance(fullText)
        else -> null
    }

    private inline fun <reified T> readFixture(relativePath: String): T {
        val root = requireNotNull(System.getProperty("contractFixturesDir"))
        return gson.fromJson(File(root, relativePath).readText(Charsets.UTF_8), T::class.java)
    }
}

private data class ProviderFixture(val cases: List<ProviderCase>)

private data class ProviderCase(
    val caseId: String,
    val source: ProviderSource,
    val raw: ProviderRaw,
    val expected: ProviderExpected
)

private data class ProviderSource(val packageName: String, val parserId: String)

private data class ProviderRaw(
    val postedAt: String? = null,
    val title: String? = null,
    val text: String? = null,
    val bigText: String? = null,
    val textLines: List<String>? = null
) {
    fun fullText(): String {
        val body = when {
            !textLines.isNullOrEmpty() -> textLines.joinToString("\n")
            !bigText.isNullOrBlank() -> bigText
            !text.isNullOrBlank() -> text
            else -> ""
        }
        return listOf(title.orEmpty(), body.orEmpty())
            .filter(String::isNotBlank)
            .joinToString("\n")
            .trim()
    }
}

private data class ProviderExpected(
    val kind: String,
    val payment: ExpectedPayment? = null,
    val balance: ExpectedBalance? = null
)

private data class ExpectedPayment(
    val type: String,
    val amountInWon: Int,
    val occurredLocalDate: String,
    val occurredLocalTime: String,
    val merchant: String,
    val cardCompany: String,
    val maskedCardToken: String? = null
)

private data class ExpectedBalance(val amountInWon: Int)

private data class CityGasFixture(val cases: List<CityGasCase>)

private data class CityGasCase(
    val caseId: String,
    val raw: CityGasRaw,
    val expected: CityGasExpected
)

private data class CityGasRaw(
    val observedAtSeoul: String,
    val title: String? = null,
    val body: String
)

private data class CityGasExpected(
    val kind: String,
    val amountInWon: Int? = null,
    val billingMonth: String? = null,
    val memoPolicy: String? = null,
    val accountingDate: String? = null
)

private data class OccurrenceFixture(val cases: List<OccurrenceCase>)

private data class OccurrenceCase(
    val caseId: String,
    val input: OccurrenceInput,
    val expected: OccurrenceExpected
)

private data class OccurrenceInput(
    val month: Int,
    val day: Int,
    val hour: Int,
    val minute: Int,
    val receivedAt: String
)

private data class OccurrenceExpected(
    val kind: String,
    val occurredLocalDateTime: String? = null
)
