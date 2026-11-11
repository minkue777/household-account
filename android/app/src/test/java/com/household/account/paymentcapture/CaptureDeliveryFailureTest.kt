package com.household.account.paymentcapture

import com.household.account.server.RemoteCommandException
import com.household.account.server.UnauthenticatedCommandException
import org.junit.Assert.assertEquals
import org.junit.Test

class CaptureDeliveryFailureTest {
    @Test fun `인증과 저장 오류를 구분하고 메시지와 예외 원문은 버린다`() {
        for ((error, expectedCode) in listOf(
            RemoteCommandException("private", java.io.IOException("private host")) to "IO_ERROR",
            UnauthenticatedCommandException() to "AUTH_REQUIRED",
            java.security.GeneralSecurityException("private key") to "KEYSTORE_ERROR",
            IllegalStateException("private payload") to "UNEXPECTED_ERROR"
        )) {
            assertEquals(mapOf(
                "observationId" to "observation-1", "stage" to "SUBMIT", "code" to expectedCode
            ), CaptureDeliveryFailure.from("observation-1", CaptureDeliveryFailureStage.SUBMIT, error).toMap())
        }
    }
}
