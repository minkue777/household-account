package com.household.account.e2e

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.functions.FirebaseFunctionsException
import com.household.account.data.NotificationDebugLogRepository
import com.household.account.paymentcapture.CallableCaptureSubmissionClient
import com.household.account.paymentcapture.CaptureDeliveryFailure
import com.household.account.paymentcapture.CaptureDeliveryFailureStage
import com.household.account.paymentcapture.RawNotificationEnvelopeV1
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import com.household.account.server.UnauthenticatedCommandException
import com.household.account.server.RemoteCommandException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@FirebaseEmulatorE2E
@RunWith(AndroidJUnit4::class)
class NotificationDiagnosticFirebaseE2ETest {
    @Test fun sdkFailureKeepsOnlyTheCodeWithoutExceptionDetails() {
        // SDK 예외의 Code 초기화는 Android SparseArray를 사용하므로 기기에서 검사합니다.
        val unavailable = FirebaseFunctionsException::class.java.getDeclaredConstructor(
            String::class.java, FirebaseFunctionsException.Code::class.java, Any::class.java
        ).apply { isAccessible = true }.newInstance(
            "secret", FirebaseFunctionsException.Code.UNAVAILABLE, mapOf("token" to "private")
        )
        assertEquals(mapOf("observationId" to "observation-1", "stage" to "SUBMIT", "code" to "CALLABLE_UNAVAILABLE"),
            CaptureDeliveryFailure.from("observation-1", CaptureDeliveryFailureStage.SUBMIT,
                RemoteCommandException("private", unavailable)).toMap())
    }

    @Test fun captureFailureSurvivesTheRealAuthenticatedDiagnosticCallable() = runBlocking {
        val fixture = JSONObject(String(Base64.decode(checkNotNull(
            InstrumentationRegistry.getArguments().getString("fixtureBase64")), Base64.DEFAULT), Charsets.UTF_8))
        check(fixture.getString("projectId") == FirebaseEmulatorTestRunner.PROJECT_ID)
        check(FirebaseApp.getInstance().options.projectId == FirebaseEmulatorTestRunner.PROJECT_ID)
        val auth = FirebaseAuth.getInstance()
        val postedAt = System.currentTimeMillis()
        val raw = RawNotificationEnvelopeV1.create(
            packageName = "gov.gyeonggi.ggcard", postedAtMillis = postedAt,
            title = "결제 완료 1,800원", text = "진단 테스트 매장", bigText = "", textLines = emptyList()
        )
        auth.signOut()
        try {
            val error = runCatching {
                CallableCaptureSubmissionClient(FirebaseAuthenticatedCallableGateway()).submit(raw)
            }.exceptionOrNull()
            assertTrue(error is UnauthenticatedCommandException)
            val failure = CaptureDeliveryFailure.from(raw.observationId, CaptureDeliveryFailureStage.SUBMIT, error as Exception)
            withTimeout(30_000) {
                auth.signInWithEmailAndPassword(fixture.getString("email"), fixture.getString("password")).await()
                NotificationDebugLogRepository().saveRawLog(
                    raw.packageName, "결제 완료 1,800원", "진단 테스트 매장", "", emptyList(),
                    "결제 완료 1,800원\n진단 테스트 매장", postedAt, failure
                )
            }
            val query = JSONObject().put("structuredQuery", JSONObject()
                .put("from", JSONArray().put(JSONObject().put("collectionId", "notification_debug_logs")))
                .put("where", JSONObject().put("fieldFilter", JSONObject()
                    .put("field", JSONObject().put("fieldPath", "captureFailure.observationId"))
                    .put("op", "EQUAL").put("value", JSONObject().put("stringValue", raw.observationId)))))
            val connection = URL("http://10.0.2.2:8080/v1/projects/${FirebaseEmulatorTestRunner.PROJECT_ID}/databases/(default)/documents:runQuery")
                .openConnection() as HttpURLConnection
            val documents = try {
                connection.requestMethod = "POST"
                connection.connectTimeout = 5_000
                connection.readTimeout = 5_000
                connection.setRequestProperty("Authorization", "Bearer owner")
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.outputStream.use { it.write(query.toString().toByteArray()) }
                check(connection.responseCode == 200)
                JSONArray(connection.inputStream.bufferedReader().use { it.readText() })
            } finally { connection.disconnect() }
            assertEquals(1, documents.length())
            val fields = documents.getJSONObject(0).getJSONObject("document").getJSONObject("fields")
            assertEquals(fixture.getString("householdId"), fields.getJSONObject("householdId").getString("stringValue"))
            assertEquals(fixture.getString("memberId"), fields.getJSONObject("memberId").getString("stringValue"))
            val recorded = fields.getJSONObject("captureFailure").getJSONObject("mapValue").getJSONObject("fields")
            assertEquals(setOf("observationId", "stage", "code"), recorded.keys().asSequence().toSet())
            assertEquals("SUBMIT", recorded.getJSONObject("stage").getString("stringValue"))
            assertEquals("AUTH_REQUIRED", recorded.getJSONObject("code").getString("stringValue"))
        } finally { auth.signOut() }
    }
}
