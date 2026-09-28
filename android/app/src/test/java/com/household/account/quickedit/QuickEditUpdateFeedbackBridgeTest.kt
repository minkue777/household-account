package com.household.account.quickedit

import com.household.account.paymentcapture.CaptureSessionScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class QuickEditUpdateFeedbackBridgeTest {
    private val scope = CaptureSessionScope("home", "member", 9)
    private fun payload() = JSONObject().put("principalUid", "principal").put("householdId", "home").put("memberId", "member")
    private fun pending() = QuickEditUpdateFeedback("command", "expense", 3, mapOf("memo" to "changed", "tags" to listOf("trip")), "pending")

    @Test fun `정확한 인증 scope에서 flat 계약과 patch를 기존 request response로 반환한다`() = runTest {
        val bridge = QuickEditUpdateFeedbackBridge({ "principal" }, { scope }, { listOf(pending()) }, { _, _ -> })
        val result = bridge.handle(QuickEditUpdateFeedbackBridge.GET_OPERATION, payload())
        assertEquals("quick-edit-update-feedback.v1", result.getString("contractVersion"))
        assertEquals("principal", result.getString("principalUid"))
        assertEquals(9L, result.getLong("nativeSessionGeneration"))
        val update = result.getJSONArray("updates").getJSONObject(0)
        assertEquals("changed", update.getJSONObject("patch").getString("memo"))
        assertEquals("trip", update.getJSONObject("patch").getJSONArray("tags").getString(0))
        assertFalse(update.has("transaction"))
    }

    @Test fun `다른 principal 가구 회원은 outbox 조회 전에 거절한다`() = runTest {
        for (field in listOf("principalUid", "householdId", "memberId")) {
            var queried = false
            val bridge = QuickEditUpdateFeedbackBridge({ "principal" }, { scope }, { queried = true; listOf(pending()) }, { _, _ -> })
            try { bridge.handle(QuickEditUpdateFeedbackBridge.GET_OPERATION, payload().put(field, "other")); fail("scope mismatch expected") }
            catch (error: IllegalArgumentException) { assertEquals("SESSION_SCOPE_MISMATCH", error.message) }
            assertFalse(queried)
        }
    }

    @Test fun `서버 조회 없는 로컬 읽기도 대기 중 generation 교체시 이전 payload를 반환하지 않는다`() = runTest {
        var activeScope = scope
        val started = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val bridge = QuickEditUpdateFeedbackBridge({ "principal" }, { activeScope }, {
            started.complete(Unit); release.await(); listOf(pending())
        }, { _, _ -> })
        val request = async {
            runCatching { bridge.handle(QuickEditUpdateFeedbackBridge.GET_OPERATION, payload()) }
        }
        started.await(); activeScope = scope.copy(sessionGeneration = 10); release.complete(Unit)
        assertEquals("SESSION_SCOPE_MISMATCH", request.await().exceptionOrNull()?.message)
    }

    @Test fun `같은 가구와 회원이어도 IO 중 Firebase 계정이 바뀌면 결과를 노출하지 않는다`() = runTest {
        var uid: String? = "principal"
        val bridge = QuickEditUpdateFeedbackBridge({ uid }, { scope }, { uid = "other"; listOf(pending()) }, { _, _ -> })
        try { bridge.handle(QuickEditUpdateFeedbackBridge.GET_OPERATION, payload()); fail("principal mismatch expected") }
        catch (error: IllegalStateException) { assertEquals("SESSION_SCOPE_MISMATCH", error.message) }
    }

    @Test fun `ack는 응답의 Native generation과 명시 command ID만 사용한다`() = runTest {
        var acknowledged: Set<String>? = null
        val bridge = QuickEditUpdateFeedbackBridge({ "principal" }, { scope }, { emptyList() }, { received, ids ->
            assertEquals(scope, received); acknowledged = ids
        })
        try { bridge.handle(QuickEditUpdateFeedbackBridge.ACK_OPERATION,
            payload().put("nativeSessionGeneration", 1).put("commandIds", JSONArray(listOf("command")))); fail("generation mismatch expected") }
        catch (error: IllegalArgumentException) { assertEquals("SESSION_SCOPE_MISMATCH", error.message) }
        assertNull(acknowledged)
        bridge.handle(QuickEditUpdateFeedbackBridge.ACK_OPERATION,
            payload().put("nativeSessionGeneration", 9).put("commandIds", JSONArray(listOf("command"))))
        assertEquals(setOf("command"), acknowledged)
    }

    @Test fun `유효하지 않은 ack ID는 어떤 결과도 지우지 않는다`() = runTest {
        var acknowledged = false
        val bridge = QuickEditUpdateFeedbackBridge({ "principal" }, { scope }, { emptyList() }, { _, _ -> acknowledged = true })
        for (ids in listOf(JSONArray(listOf(123)), JSONArray(listOf("")))) {
            try { bridge.handle(QuickEditUpdateFeedbackBridge.ACK_OPERATION,
                payload().put("nativeSessionGeneration", 9).put("commandIds", ids)); fail("invalid IDs expected") }
            catch (_: IllegalArgumentException) { }
        }
        assertFalse(acknowledged)
    }
}
