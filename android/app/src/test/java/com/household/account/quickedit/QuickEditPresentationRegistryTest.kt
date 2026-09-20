package com.household.account.quickedit

import com.household.account.paymentcapture.CaptureSessionScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class QuickEditPresentationRegistryTest {
    private val scope = CaptureSessionScope("house", "member", 7)
    private var now = 0L
    private val registry = QuickEditPresentationRegistry({ now })
    private class Owner : QuickEditPresentationOwner {
        override var isQuickEditAlive = true
        override var isQuickEditVisible = true
    }

    @Test fun `창만 제거되어도 같은 프로세스에서 기존 head와 후속 세 거래를 복구한다`() = runTest {
        val store = object : QuickEditQueueStore {
            var state = QuickEditQueueState()
            override fun load() = state
            override fun replace(state: QuickEditQueueState) { this.state = state }
            override fun clear() { state = QuickEditQueueState() }
        }
        val queue = QuickEditPendingQueue(store)
        val owner = Owner()
        queue.enqueueAndAcquireIfIdle(scope, "old")
        registry.beginLaunch(scope, "old")
        registry.created(scope, "old", owner)
        registry.started(scope, "old", owner)
        registry.destroyed(scope, "old", owner, changingConfigurations = false)
        listOf("new-1", "new-2", "new-3").forEach { queue.enqueue(scope, it) }

        assertTrue(registry.needsRecovery(scope, "old"))
        queue.releaseLease(scope, "old")
        val shown = mutableListOf<String>()
        repeat(4) {
            val head = requireNotNull(queue.acquireHead(scope))
            shown += head.transactionId
            queue.complete(scope, head.transactionId)
        }
        assertEquals(listOf("old", "new-1", "new-2", "new-3"), shown)
        assertTrue(store.state.entries.isEmpty())
    }

    @Test fun `실제 표시 중인 창은 오래 지나도 중복 실행하지 않고 숨은 창만 복구한다`() {
        val owner = Owner()
        val request = registry.beginLaunch(scope, "a")
        registry.created(scope, "a", owner)
        registry.started(scope, "a", owner)
        now = 86_400_000
        assertFalse(registry.needsRecovery(scope, "a"))
        assertFalse(registry.expireLaunch(scope, "a", request))
        owner.isQuickEditVisible = false
        assertTrue(registry.needsRecovery(scope, "a"))
        assertTrue(registry.canReuseActivity(scope, "a"))
        assertFalse(registry.canReuseActivity(scope, "b"))
        registry.beginLaunch(scope, "a")
        assertFalse(registry.needsRecovery(scope, "a"))
        owner.isQuickEditVisible = true
        registry.started(scope, "a", owner)
        assertFalse(registry.needsRecovery(scope, "a"))
    }

    @Test fun `실행 요청만 성공하고 Activity가 시작되지 않으면 정확히 10초에 복구한다`() {
        val request = registry.beginLaunch(scope, "a")
        val owner = Owner().apply { isQuickEditVisible = false }
        registry.created(scope, "a", owner)
        now = 9_999
        assertFalse(registry.expireLaunch(scope, "a", request))
        now = 10_000
        assertTrue(registry.expireLaunch(scope, "a", request))
        assertTrue(registry.needsRecovery(scope, "a"))
        assertFalse(registry.expireLaunch(scope, "a", request))
    }

    @Test fun `이전 timeout은 재시도 요청이나 다음 거래의 표시 상태를 해제하지 않는다`() {
        val old = registry.beginLaunch(scope, "a")
        now = 10_000
        val current = registry.beginLaunch(scope, "a")
        assertFalse(registry.expireLaunch(scope, "a", old))
        assertFalse(registry.needsRecovery(scope, "a"))
        registry.complete(scope, "a")
        registry.beginLaunch(scope, "b")
        now += 10_000
        assertFalse(registry.expireLaunch(scope, "a", current))
    }

    @Test fun `화면 회전 동안에는 중복 표시하지 않고 이전 owner의 종료는 새 창을 지우지 않는다`() {
        val old = Owner()
        registry.beginLaunch(scope, "a")
        registry.created(scope, "a", old)
        registry.started(scope, "a", old)
        registry.destroyed(scope, "a", old, changingConfigurations = true)
        assertFalse(registry.needsRecovery(scope, "a"))
        val recreated = Owner()
        registry.created(scope, "a", recreated)
        registry.started(scope, "a", recreated)
        registry.destroyed(scope, "a", old, changingConfigurations = false)
        now = 20_000
        assertFalse(registry.needsRecovery(scope, "a"))
        recreated.isQuickEditAlive = false
        assertTrue(registry.needsRecovery(scope, "a"))
    }

    @Test fun `끝나지 않은 재생성도 영구히 대기하지 않는다`() {
        val old = Owner()
        registry.created(scope, "a", old)
        registry.destroyed(scope, "a", old, changingConfigurations = true)
        now = 10_000
        assertTrue(registry.needsRecovery(scope, "a"))
    }

    @Test fun `다른 세션에는 표시 소유권이 넘어가지 않고 purge 후 늦은 timeout은 무시한다`() {
        val request = registry.beginLaunch(scope, "a")
        val next = scope.copy(sessionGeneration = 8)
        assertTrue(registry.needsRecovery(next, "a"))
        registry.beginLaunch(next, "a")
        registry.purge(scope)
        now = 10_000
        assertFalse(registry.expireLaunch(scope, "a", request))
        assertFalse(registry.expireLaunch(next, "a", request))
    }
}
