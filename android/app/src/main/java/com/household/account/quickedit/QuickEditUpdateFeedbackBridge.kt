package com.household.account.quickedit

import com.household.account.paymentcapture.CaptureSessionScope
import org.json.JSONArray
import org.json.JSONObject

/** 정확한 origin 검사는 host가 담당하고 이 경계는 매 요청의 인증 identity를 재검증합니다. */
class QuickEditUpdateFeedbackBridge(
    private val currentPrincipalUid: () -> String?,
    private val currentScope: () -> CaptureSessionScope,
    private val readFeedback: suspend (CaptureSessionScope) -> List<QuickEditUpdateFeedback>,
    private val acknowledge: suspend (CaptureSessionScope, Set<String>) -> Unit
) {
    suspend fun handle(operation: String, payload: JSONObject): JSONObject {
        val principalUid = payload.optString("principalUid")
        val householdId = payload.optString("householdId")
        val memberId = payload.optString("memberId")
        val scope = currentScope()
        require(principalUid.isNotBlank() && currentPrincipalUid() == principalUid &&
            scope.isUsable && scope.householdId == householdId && scope.memberId == memberId) {
            "SESSION_SCOPE_MISMATCH"
        }
        val updates = when (operation) {
            GET_OPERATION -> readFeedback(scope)
            ACK_OPERATION -> {
                val generation = payload.opt("nativeSessionGeneration") as? Number
                require(generation != null && generation.toDouble() == scope.sessionGeneration.toDouble()) {
                    "SESSION_SCOPE_MISMATCH"
                }
                val ids = payload.optJSONArray("commandIds") ?: error("INVALID_PAYLOAD")
                val commandIds = (0 until ids.length()).map { index ->
                    val id = ids.opt(index)
                    require(id is String && id.isNotBlank() && id.length <= 256) { "INVALID_PAYLOAD" }
                    id
                }.toSet()
                acknowledge(scope, commandIds)
                emptyList()
            }
            else -> error("UNKNOWN_OPERATION")
        }
        // IO 대기 동안 탈퇴/로그아웃/다른 계정 전환이 일어나면 이전 결과를 노출하지 않습니다.
        check(currentPrincipalUid() == principalUid && currentScope() == scope) { "SESSION_SCOPE_MISMATCH" }
        return JSONObject()
            .put("contractVersion", CONTRACT_VERSION)
            .put("principalUid", principalUid)
            .put("householdId", householdId)
            .put("memberId", memberId)
            .put("nativeSessionGeneration", scope.sessionGeneration)
            .put("updates", JSONArray().apply {
                updates.forEach { update ->
                    put(JSONObject()
                        .put("commandId", update.commandId)
                        .put("transactionId", update.transactionId)
                        .put("expectedVersion", update.expectedVersion)
                        .put("patch", JSONObject(update.patch))
                        .put("state", update.state)
                        .apply { update.transaction?.let { put("transaction", JSONObject(it)) } })
                }
            })
    }

    companion object {
        const val GET_OPERATION = "quick-edit.get-update-feedback"
        const val ACK_OPERATION = "quick-edit.ack-update-feedback"
        const val CONTRACT_VERSION = "quick-edit-update-feedback.v1"
        const val CHANGED_EVENT = "household-account:quick-edit-updates-changed"
    }
}
