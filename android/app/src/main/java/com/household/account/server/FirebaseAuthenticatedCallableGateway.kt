package com.household.account.server

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.tasks.await

/**
 * Firebase callable SDK가 현재 사용자의 ID token을 Authorization context에 자동 첨부합니다.
 * 호출 전에 token을 실제로 얻어 Native 인증이 없는 요청이 익명으로 전송되는 것을 막습니다.
 */
class FirebaseAuthenticatedCallableGateway(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val functions: FirebaseFunctions = FirebaseFunctions.getInstance(REGION)
) : AuthenticatedCallableGateway {

    override suspend fun call(
        functionName: String,
        payload: Map<String, Any?>
    ): Map<String, Any?> {
        if (auth.currentUser == null) throw UnauthenticatedCommandException()

        try {
            val data = functions
                .getHttpsCallable(functionName)
                .call(payload)
                .await()
                .data

            @Suppress("UNCHECKED_CAST")
            return data as? Map<String, Any?>
                ?: throw RemoteCommandException("Callable response must be an object")
        } catch (error: UnauthenticatedCommandException) {
            throw error
        } catch (error: RemoteCommandException) {
            throw error
        } catch (error: Exception) {
            throw RemoteCommandException("Callable request failed", error)
        }
    }

    companion object {
        const val REGION = "asia-northeast3"
    }
}
