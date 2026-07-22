package com.household.account.auth

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async

/**
 * WebView가 bridge를 호출하기 전에 시작한 세션 교환을 정확히 한 번 재사용합니다.
 *
 * prewarm은 이미 인증된 Native principal에 대해서만 호출하는 상위 정책을 전제로 하며,
 * producer 자체는 Google 로그인 UI를 열지 않는 함수여야 합니다.
 */
internal class SingleUseSessionPrewarmer<Value> {
    private val lock = Any()
    private var prepared: Deferred<Value>? = null

    fun prepare(
        scope: CoroutineScope,
        producer: suspend () -> Value
    ) {
        synchronized(lock) {
            if (prepared != null) return
            prepared = scope.async(Dispatchers.IO) { producer() }
        }
    }

    suspend fun consumeOr(producer: suspend () -> Value): Value {
        val prefetched = synchronized(lock) {
            prepared.also { prepared = null }
        }
        return prefetched?.await() ?: producer()
    }

    fun clear() {
        synchronized(lock) {
            prepared?.cancel()
            prepared = null
        }
    }
}
