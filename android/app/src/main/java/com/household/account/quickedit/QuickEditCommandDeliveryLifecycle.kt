package com.household.account.quickedit

import com.household.account.ledger.HouseholdCommandEnvelopeV1
import com.household.account.paymentcapture.CaptureSessionScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * QuickEdit command 접수와 session purge의 짧은 로컬 임계 구역만 직렬화합니다.
 * 서버 왕복은 이 lock에 포함하지 않아 다음 QuickEdit 접수를 막지 않습니다.
 */
internal class QuickEditCommandDeliveryLifecycle {
    private val mutex = Mutex()
    private var blockedScope: CaptureSessionScope? = null

    suspend fun admit(
        currentScope: () -> CaptureSessionScope,
        transactionId: String,
        envelope: HouseholdCommandEnvelopeV1,
        persist: suspend (CaptureSessionScope, String, HouseholdCommandEnvelopeV1) -> Boolean,
        reserveDelivery: suspend () -> Unit
    ): QuickEditCommandEnqueueResult = mutex.withLock {
        val scope = currentScope()
        if (!scope.isUsable || envelope.householdId != scope.householdId) {
            return@withLock QuickEditCommandEnqueueResult.Rejected(
                "HOUSEHOLD_SESSION_REQUIRED"
            )
        }
        if (blockedScope == scope) {
            return@withLock QuickEditCommandEnqueueResult.Rejected(
                "SESSION_TRANSITION_IN_PROGRESS"
            )
        }
        if (blockedScope != null) blockedScope = null

        val stored = try {
            persist(scope, transactionId, envelope)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return@withLock QuickEditCommandEnqueueResult.Rejected(
                "QUICK_EDIT_OUTBOX_WRITE_FAILED"
            )
        }
        if (!stored) {
            return@withLock QuickEditCommandEnqueueResult.Rejected(
                "QUICK_EDIT_OUTBOX_REJECTED"
            )
        }

        try {
            reserveDelivery()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // payload는 outbox에 그대로 남는다. 동일 envelope 재접수는 중복 저장 없이
            // WorkManager 영속 예약만 다시 시도할 수 있다.
            return@withLock QuickEditCommandEnqueueResult.Rejected(
                "QUICK_EDIT_WORK_SCHEDULE_FAILED"
            )
        }
        QuickEditCommandEnqueueResult.Accepted
    }

    suspend fun purge(
        currentScope: () -> CaptureSessionScope,
        clearOutbox: suspend () -> Unit,
        cancelDelivery: suspend () -> Unit
    ) = mutex.withLock {
        val scope = currentScope()
        clearOutbox()
        cancelDelivery()
        blockedScope = scope
    }

    suspend fun <T> runExclusive(block: suspend () -> T): T = mutex.withLock {
        block()
    }
}
