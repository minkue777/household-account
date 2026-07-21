package com.household.account.server

/**
 * Firebase SDK를 Application 경계 밖으로 밀어내는 인증된 callable 전송 Port입니다.
 * Actor/UID/역할은 payload에 넣지 않고 Firebase Auth ID token으로 서버가 도출합니다.
 */
interface AuthenticatedCallableGateway {
    suspend fun call(functionName: String, payload: Map<String, Any?>): Map<String, Any?>
}

class UnauthenticatedCommandException : IllegalStateException("Native Firebase authentication is required")

class RemoteCommandException(message: String, cause: Throwable? = null) : Exception(message, cause)
