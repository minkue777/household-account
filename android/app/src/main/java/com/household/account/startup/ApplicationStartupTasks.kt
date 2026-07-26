package com.household.account.startup

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * 앱 프로세스마다 한 번만 FCM 전달 차단과 QuickEdit outbox 복구를 예약합니다.
 *
 * 이 클래스에 전달하는 scope는 메인 스레드가 아닌 백그라운드 dispatcher를 사용해야 합니다.
 */
internal class ApplicationStartupTasks(
    private val scope: CoroutineScope,
    private val quickEditRecoveryDelayMillis: Long,
    private val enforceFcmDeliveryGate: () -> Unit,
    private val resumeQuickEditOutbox: () -> Unit
) {
    private val scheduled = AtomicBoolean(false)

    fun schedule() {
        if (!scheduled.compareAndSet(false, true)) return

        scope.launch {
            runBestEffort(enforceFcmDeliveryGate)
            delay(quickEditRecoveryDelayMillis)
            runBestEffort(resumeQuickEditOutbox)
        }
    }

    private inline fun runBestEffort(block: () -> Unit) {
        try {
            block()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // 다음 프로세스 시작 또는 이미 예약된 Worker가 복구를 다시 시도합니다.
        }
    }
}
