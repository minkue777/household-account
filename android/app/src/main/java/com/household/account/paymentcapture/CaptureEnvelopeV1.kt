package com.household.account.paymentcapture

import org.json.JSONObject

data class AndroidRegisteredPackageEvidence(
    val sourceType: String,
    val packageName: String,
    val registryVersion: String = "source-registry.v1"
) {
    fun toMap(): Map<String, Any> = mapOf(
        "kind" to "android-registered-package",
        "sourceType" to sourceType,
        "packageName" to packageName,
        "registryVersion" to registryVersion
    )
}

data class ParserEvidenceV1(
    val parserId: String,
    val parserVersion: String
) {
    fun toMap(): Map<String, Any> = mapOf(
        "parserId" to parserId,
        "parserVersion" to parserVersion
    )
}

data class CardEvidenceV1(
    val companyLabel: String,
    val maskedToken: String? = null
) {
    fun toMap(): Map<String, Any> = buildMap {
        put("companyLabel", companyLabel)
        maskedToken?.takeIf { it.isNotBlank() }?.let { put("maskedToken", it) }
    }
}

data class PaymentObservationV1(
    val branchId: String,
    val observationType: String,
    val amountInWon: Int,
    val occurredLocalDate: String?,
    val occurredLocalTime: String?,
    val merchantCandidate: String,
    val cardEvidence: CardEvidenceV1?,
    val localCurrencyType: String? = null,
    val dueDate: String? = null
) {
    fun toMap(): Map<String, Any> = buildMap {
        put("branchId", branchId)
        put("observationType", observationType)
        put("amountInWon", amountInWon)
        occurredLocalDate?.takeIf { it.isNotBlank() }?.let { put("occurredLocalDate", it) }
        occurredLocalTime?.takeIf { it.isNotBlank() }?.let { put("occurredLocalTime", it) }
        put("zoneId", "Asia/Seoul")
        put("merchantEvidence", mapOf("rawCandidate" to merchantCandidate))
        cardEvidence?.let { put("cardEvidence", it.toMap()) }
        localCurrencyType?.takeIf { it.isNotBlank() }?.let { put("localCurrencyType", it) }
        dueDate?.takeIf { it.isNotBlank() }?.let { put("dueDate", it) }
    }
}

data class BalanceObservationV1(
    val branchId: String,
    val currencyType: String,
    val balanceInWon: Int,
    val observedAt: String
) {
    fun toMap(): Map<String, Any> = mapOf(
        "branchId" to branchId,
        "currencyType" to currencyType,
        "balanceInWon" to balanceInWon,
        "observedAt" to observedAt
    )
}

/** 원문을 포함하지 않는 Android → Payment Intake wire 계약입니다. */
data class CaptureEnvelopeV1(
    val observationId: String,
    val sourceEvidence: AndroidRegisteredPackageEvidence,
    val observedAt: String,
    val parser: ParserEvidenceV1,
    val rawPayloadHash: String,
    val paymentObservation: PaymentObservationV1? = null,
    val balanceObservation: BalanceObservationV1? = null
) {
    init {
        require(paymentObservation != null || balanceObservation != null) {
            "CaptureEnvelope requires at least one branch"
        }
    }

    fun toMap(): Map<String, Any> = buildMap {
        put("contractVersion", CONTRACT_VERSION)
        put("observationId", observationId)
        put("originChannel", "android-notification")
        put("sourceEvidence", sourceEvidence.toMap())
        put("observedAt", observedAt)
        put("parser", parser.toMap())
        put("rawPayloadHash", rawPayloadHash)
        paymentObservation?.let { put("paymentObservation", it.toMap()) }
        balanceObservation?.let { put("balanceObservation", it.toMap()) }
    }

    fun toJson(): String = JSONObject(toMap()).toString()

    companion object {
        const val CONTRACT_VERSION = "capture-envelope.v1"

        fun fromJson(value: String): CaptureEnvelopeV1 {
            val root = JSONObject(value)
            require(root.getString("contractVersion") == CONTRACT_VERSION)
            require(root.getString("originChannel") == "android-notification")

            val source = root.getJSONObject("sourceEvidence")
            val parser = root.getJSONObject("parser")
            val payment = root.optJSONObject("paymentObservation")?.let { json ->
                val merchant = json.getJSONObject("merchantEvidence")
                val card = json.optJSONObject("cardEvidence")
                PaymentObservationV1(
                    branchId = json.getString("branchId"),
                    observationType = json.getString("observationType"),
                    amountInWon = json.getInt("amountInWon"),
                    occurredLocalDate = json.optionalString("occurredLocalDate"),
                    occurredLocalTime = json.optionalString("occurredLocalTime"),
                    merchantCandidate = merchant.getString("rawCandidate"),
                    cardEvidence = card?.let {
                        CardEvidenceV1(
                            companyLabel = it.getString("companyLabel"),
                            maskedToken = it.optionalString("maskedToken")
                        )
                    },
                    localCurrencyType = json.optionalString("localCurrencyType"),
                    dueDate = json.optionalString("dueDate")
                )
            }
            val balance = root.optJSONObject("balanceObservation")?.let { json ->
                BalanceObservationV1(
                    branchId = json.getString("branchId"),
                    currencyType = json.getString("currencyType"),
                    balanceInWon = json.getInt("balanceInWon"),
                    observedAt = json.getString("observedAt")
                )
            }

            return CaptureEnvelopeV1(
                observationId = root.getString("observationId"),
                sourceEvidence = AndroidRegisteredPackageEvidence(
                    sourceType = source.getString("sourceType"),
                    packageName = source.getString("packageName"),
                    registryVersion = source.getString("registryVersion")
                ),
                observedAt = root.getString("observedAt"),
                parser = ParserEvidenceV1(
                    parserId = parser.getString("parserId"),
                    parserVersion = parser.getString("parserVersion")
                ),
                rawPayloadHash = root.getString("rawPayloadHash"),
                paymentObservation = payment,
                balanceObservation = balance
            )
        }
    }
}

private fun JSONObject.optionalString(key: String): String? =
    if (has(key) && !isNull(key)) getString(key).takeIf { it.isNotBlank() } else null
