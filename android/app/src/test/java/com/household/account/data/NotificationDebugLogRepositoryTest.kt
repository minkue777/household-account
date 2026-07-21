package com.household.account.data

import com.household.account.server.AuthenticatedCallableGateway
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class NotificationDebugLogRepositoryTest {

    @Test
    fun `actor와 source를 클라이언트가 주장하지 않고 서버 진단 callable로 원문을 보낸다`() = runTest {
        var calledFunction = ""
        var calledPayload: Map<String, Any?> = emptyMap()
        val gateway = object : AuthenticatedCallableGateway {
            override suspend fun call(
                functionName: String,
                payload: Map<String, Any?>
            ): Map<String, Any?> {
                calledFunction = functionName
                calledPayload = payload
                return mapOf(
                    "contractVersion" to "notification-diagnostic-response.v1",
                    "result" to mapOf("kind" to "Collected")
                )
            }
        }

        NotificationDebugLogRepository(gateway).saveRawLog(
            packageName = "com.example.card",
            title = "승인",
            text = "본문",
            bigText = "긴 본문",
            textLines = listOf("첫 줄", "둘째 줄"),
            fullText = "승인\n본문",
            postedAtMillis = 1_768_879_800_000
        )

        assertEquals(NotificationDebugLogRepository.FUNCTION_NAME, calledFunction)
        assertEquals("com.example.card", calledPayload["packageName"])
        assertEquals(listOf("첫 줄", "둘째 줄"), calledPayload["textLines"])
        assertEquals(1_768_879_800_000, calledPayload["postedAtMillis"])
        assertFalse(calledPayload.containsKey("householdId"))
        assertFalse(calledPayload.containsKey("memberId"))
        assertFalse(calledPayload.containsKey("memberName"))
        assertFalse(calledPayload.containsKey("source"))
    }
}
