package com.household.account.paymentcapture

import com.household.account.data.Expense
import com.household.account.parser.ExpenseEventType
import com.household.account.parser.LocalCurrencyBalanceResult
import com.household.account.util.CardLabelFormatter
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

object CaptureEnvelopeFactory {
    private val seoul = ZoneId.of("Asia/Seoul")
    private val datePattern = Regex("""^\d{4}-\d{2}-\d{2}$""")
    private val timePattern = Regex("""^(?:[01]\d|2[0-3]):[0-5]\d$""")
    private val supportedCurrencyTypes = setOf("gyeonggi", "daejeon", "sejong")

    fun create(
        packageName: String,
        source: RegisteredNotificationSource,
        postedAtMillis: Long,
        rawNotificationText: String,
        expense: Expense?,
        eventType: ExpenseEventType?,
        balance: LocalCurrencyBalanceResult?,
        observationId: String = "observation.android.${UUID.randomUUID().toString().replace("-", "")}"
    ): CaptureEnvelopeV1? {
        val payment = expense
            ?.takeIf { it.amount > 0 && it.merchant.isNotBlank() && eventType != null }
        val balanceAmount = balance?.balance

        if (payment == null && balanceAmount == null) return null

        val observedInstant = Instant.ofEpochMilli(postedAtMillis.coerceAtLeast(0L))
        val observedAt = DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(observedInstant.atZone(seoul))
        val payloadHash = sha256("$packageName\u0000$rawNotificationText")
        require(observationId.matches(Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")))
        val branchStem = observationId.removePrefix("observation.")

        val paymentObservation = payment?.let {
            val parsedLabel = CardLabelFormatter.extractCardLabel(it.cardLastFour)
                ?: source.companyLabel
            val token = CardLabelFormatter.extractCardToken(it.cardLastFour)
            PaymentObservationV1(
                branchId = "branch.$branchStem.payment",
                observationType = if (eventType == ExpenseEventType.CANCELLATION) {
                    "cancellation"
                } else {
                    "approval"
                },
                amountInWon = it.amount,
                occurredLocalDate = it.date.takeIf(datePattern::matches),
                occurredLocalTime = it.time.takeIf(timePattern::matches),
                merchantCandidate = it.merchant.trim(),
                cardEvidence = if (source == RegisteredNotificationSource.CITY_GAS_BILL) {
                    null
                } else {
                    CardEvidenceV1(parsedLabel, token)
                },
                localCurrencyType = source.localCurrencyType,
                dueDate = if (source == RegisteredNotificationSource.CITY_GAS_BILL) {
                    it.date.takeIf(datePattern::matches)
                } else {
                    null
                }
            )
        }

        val balanceObservation = balanceAmount?.let {
            val currencyType = (
                source.localCurrencyType
                    ?: balance.currencyType?.trim()?.takeIf(String::isNotBlank)
                )?.takeIf(supportedCurrencyTypes::contains)
                ?: return@let null
            BalanceObservationV1(
                branchId = "branch.$branchStem.balance",
                currencyType = currencyType,
                balanceInWon = it,
                observedAt = observedAt
            )
        }

        if (paymentObservation == null && balanceObservation == null) return null

        return CaptureEnvelopeV1(
            observationId = observationId,
            sourceEvidence = AndroidRegisteredPackageEvidence(
                sourceType = source.sourceType,
                packageName = packageName,
                registryVersion = PaymentSourceRegistry.VERSION
            ),
            observedAt = observedAt,
            parser = ParserEvidenceV1(source.parserId, source.parserVersion),
            rawPayloadHash = payloadHash,
            paymentObservation = paymentObservation,
            balanceObservation = balanceObservation
        )
    }

    private fun sha256(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return "sha256:" + bytes.joinToString("") { "%02x".format(it) }
    }
}
