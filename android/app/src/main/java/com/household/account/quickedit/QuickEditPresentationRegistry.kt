package com.household.account.quickedit

import com.household.account.paymentcapture.CaptureSessionScope
import java.lang.ref.WeakReference

interface QuickEditPresentationOwner {
    val isQuickEditAlive: Boolean
    val isQuickEditVisible: Boolean
}

/** Durable FIFO와 별개로 실제 창의 수명을 추적한다. 모든 callback은 이전 owner/request를 식별한다. */
class QuickEditPresentationRegistry(
    private val elapsedRealtimeMillis: () -> Long,
    private val launchTimeoutMillis: Long = LAUNCH_TIMEOUT_MILLIS
) {
    private data class Key(val scope: CaptureSessionScope, val transactionId: String)
    private data class Presentation(
        val requestId: Long,
        val requestedAt: Long,
        val pending: Boolean,
        val owner: WeakReference<QuickEditPresentationOwner>? = null
    )

    private val presentations = mutableMapOf<Key, Presentation>()
    private var nextRequestId = 0L

    @Synchronized
    fun canReuseActivity(scope: CaptureSessionScope, transactionId: String): Boolean =
        presentations[Key(scope, transactionId)]?.owner?.get()?.isQuickEditAlive == true

    @Synchronized
    fun needsRecovery(scope: CaptureSessionScope, transactionId: String): Boolean {
        val entry = presentations[Key(scope, transactionId)] ?: return true
        val owner = entry.owner?.get()
        if (owner?.isQuickEditAlive == true && owner.isQuickEditVisible) return false
        return !entry.pending || elapsedRealtimeMillis() - entry.requestedAt >= launchTimeoutMillis
    }

    @Synchronized
    fun beginLaunch(scope: CaptureSessionScope, transactionId: String): Long {
        val key = Key(scope, transactionId)
        val requestId = ++nextRequestId
        presentations[key] = Presentation(
            requestId, elapsedRealtimeMillis(), pending = true, owner = presentations[key]?.owner
        )
        return requestId
    }

    @Synchronized
    fun created(scope: CaptureSessionScope, transactionId: String, owner: QuickEditPresentationOwner) {
        val key = Key(scope, transactionId)
        val entry = presentations[key] ?: Presentation(++nextRequestId, elapsedRealtimeMillis(), true)
        presentations[key] = entry.copy(owner = WeakReference(owner))
    }

    @Synchronized
    fun started(scope: CaptureSessionScope, transactionId: String, owner: QuickEditPresentationOwner) {
        val key = Key(scope, transactionId)
        val entry = presentations[key] ?: return
        if (entry.owner?.get() === owner) presentations[key] = entry.copy(pending = false)
    }

    @Synchronized
    fun destroyed(
        scope: CaptureSessionScope,
        transactionId: String,
        owner: QuickEditPresentationOwner,
        changingConfigurations: Boolean
    ) {
        val key = Key(scope, transactionId)
        val entry = presentations[key] ?: return
        if (entry.owner?.get() !== owner) return
        presentations[key] = entry.copy(
            requestId = ++nextRequestId,
            requestedAt = elapsedRealtimeMillis(),
            pending = changingConfigurations,
            owner = null
        )
    }

    @Synchronized
    fun expireLaunch(scope: CaptureSessionScope, transactionId: String, requestId: Long): Boolean {
        val key = Key(scope, transactionId)
        val entry = presentations[key] ?: return false
        if (entry.requestId != requestId || !entry.pending || !needsRecovery(scope, transactionId)) return false
        presentations[key] = entry.copy(pending = false)
        return true
    }

    @Synchronized
    fun complete(scope: CaptureSessionScope, transactionId: String) {
        presentations.remove(Key(scope, transactionId))
    }

    @Synchronized
    fun purge(scope: CaptureSessionScope?) {
        if (scope == null) presentations.clear() else presentations.keys.removeAll { it.scope == scope }
    }

    companion object {
        const val LAUNCH_TIMEOUT_MILLIS = 10_000L
    }
}
