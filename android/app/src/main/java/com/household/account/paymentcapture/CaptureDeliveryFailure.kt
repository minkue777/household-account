package com.household.account.paymentcapture

import com.google.firebase.functions.FirebaseFunctionsException
import com.household.account.server.RemoteCommandException
import com.household.account.server.UnauthenticatedCommandException
import java.io.IOException
import java.security.GeneralSecurityException

enum class CaptureDeliveryFailureStage { SCOPE, ENQUEUE, QUEUE_READ, SUBMIT, LOCAL_COMMIT }

/** 원문·토큰·예외 메시지 대신 실패 위치와 제한된 코드만 진단에 첨부합니다. */
data class CaptureDeliveryFailure(
    val observationId: String,
    val stage: CaptureDeliveryFailureStage,
    val code: String
) {
    fun toMap(): Map<String, String> = mapOf(
        "observationId" to observationId,
        "stage" to stage.name,
        "code" to code
    )

    companion object {
        fun from(observationId: String, stage: CaptureDeliveryFailureStage, error: Exception) =
            CaptureDeliveryFailure(observationId, stage, codeFor(error))

        private fun codeFor(error: Throwable): String = when (error) {
            is UnauthenticatedCommandException -> "AUTH_REQUIRED"
            is FirebaseFunctionsException -> "CALLABLE_${error.code.name}"
            is RemoteCommandException -> error.cause?.let(::codeFor) ?: "REMOTE_ERROR"
            is CaptureSubmissionContractException -> "RECEIPT_INVALID"
            is CaptureIdempotencyPayloadMismatchException -> "PAYLOAD_CONFLICT"
            is IOException -> "IO_ERROR"
            is GeneralSecurityException -> "KEYSTORE_ERROR"
            is SecurityException -> "PERMISSION_DENIED"
            else -> "UNEXPECTED_ERROR"
        }
    }
}
