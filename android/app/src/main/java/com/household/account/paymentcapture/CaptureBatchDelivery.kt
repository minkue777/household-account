package com.household.account.paymentcapture

/**
 * 한 OS 알림의 모든 envelope를 먼저 journal에 기록한 뒤, 네트워크 호출은 Queue mutex
 * 밖에서 순서대로 실행합니다. 각 commit은 짧은 Queue 연산으로 직렬화되어 동시 enqueue를
 * 덮어쓰지 않습니다.
 */
internal suspend fun enqueueAndSubmitCaptureBatch(
    queue: CaptureDeliveryQueue,
    scope: CaptureSessionScope,
    envelopes: List<CaptureDeliveryEnvelope>,
    client: CaptureSubmissionClient,
    afterJournalPersisted: (List<CaptureDeliveryEnvelope>) -> Unit = {},
    beforeCommitFollowUps: suspend (List<CaptureDeliveryFollowUp>) -> Unit = {}
): CaptureFlushOutcome? {
    val persistedEnvelopes = when (val result = queue.enqueueAll(scope, envelopes)) {
        is CaptureBatchEnqueueResult.Accepted -> result.persistedEnvelopes
        is CaptureBatchEnqueueResult.PayloadConflict -> {
            throw CaptureIdempotencyPayloadMismatchException(result.observationId)
        }
        CaptureBatchEnqueueResult.Rejected -> return null
    }
    if (persistedEnvelopes.isEmpty()) return null
    afterJournalPersisted(persistedEnvelopes)

    val followUps = mutableListOf<CaptureDeliveryFollowUp>()
    var retainedCount = 0
    persistedEnvelopes.forEach { envelope ->
        val receipt = try {
            client.submit(envelope)
        } catch (_: Exception) {
            retainedCount++
            return@forEach
        }
        val decision = evaluateCaptureReceipt(envelope, receipt)
        try {
            beforeCommitFollowUps(decision.followUps)
        } catch (_: Exception) {
            retainedCount++
            return@forEach
        }

        val committed = if (decision.completed) {
            queue.completeAfterAttempt(scope, envelope)
        } else {
            queue.retainAfterAttempt(scope, envelope, decision.terminalBranches)
        }
        if (!committed) {
            retainedCount++
            return@forEach
        }
        followUps += decision.followUps
        if (!decision.completed) retainedCount++
    }
    return CaptureFlushOutcome(followUps, retainedCount)
}

internal class CaptureIdempotencyPayloadMismatchException(
    observationId: String
) : IllegalStateException("Capture payload does not match observation id: $observationId")
