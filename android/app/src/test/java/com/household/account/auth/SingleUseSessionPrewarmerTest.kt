package com.household.account.auth

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SingleUseSessionPrewarmerTest {
    @Test
    fun `WebView 요청은 진행 중인 prewarm 결과를 한 번만 재사용한다`() = runTest {
        val release = CompletableDeferred<Unit>()
        var calls = 0
        val prewarmer = SingleUseSessionPrewarmer<String>()

        prewarmer.prepare(this) {
            calls += 1
            release.await()
            "prefetched-session"
        }
        release.complete(Unit)

        val first = prewarmer.consumeOr {
            calls += 1
            "interactive-session"
        }
        val second = prewarmer.consumeOr {
            calls += 1
            "next-session"
        }

        assertEquals("prefetched-session", first)
        assertEquals("next-session", second)
        assertEquals(2, calls)
    }

    @Test
    fun `clear는 미사용 prewarm을 다음 로그인에 재사용하지 않는다`() = runTest {
        val prewarmer = SingleUseSessionPrewarmer<String>()
        prewarmer.prepare(this) { "stale-session" }

        prewarmer.clear()

        assertEquals("fresh-session", prewarmer.consumeOr { "fresh-session" })
    }
}
