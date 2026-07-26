package com.household.account.paymentcapture

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * 암호화 캡처 큐 확인과 WorkManager 예약을 호출 스택 밖에서 실행합니다.
 *
 * 프로덕션에서는 IO dispatcher를 가진 scope를 전달합니다.
 */
internal class CaptureRetryWorkScheduler(
    private val scope: CoroutineScope
) {
    fun schedule(
        hasPendingCaptures: () -> Boolean,
        enqueueRetryWork: () -> Unit
    ) {
        scope.launch {
            if (hasPendingCaptures()) enqueueRetryWork()
        }
    }
}
