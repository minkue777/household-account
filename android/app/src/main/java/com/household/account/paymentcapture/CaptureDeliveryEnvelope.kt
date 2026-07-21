package com.household.account.paymentcapture

import org.json.JSONObject

sealed interface CaptureDeliveryEnvelope {
    val observationId: String
    fun toMap(): Map<String, Any>
    fun toJson(): String
}

fun decodeCaptureDeliveryEnvelope(value: String): CaptureDeliveryEnvelope {
    val root = JSONObject(value)
    return when (root.getString("contractVersion")) {
        CaptureEnvelopeV1.CONTRACT_VERSION -> CaptureEnvelopeV1.fromJson(value)
        RawNotificationEnvelopeV1.CONTRACT_VERSION -> RawNotificationEnvelopeV1.fromJson(value)
        else -> error("Unsupported capture delivery contract")
    }
}
