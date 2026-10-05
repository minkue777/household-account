package com.household.account.paymentcapture

/** OS 알림의 모든 후보를 먼저 내구화한 뒤 재시도와 같은 전달 경로를 사용합니다. */
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

    return queue.flush(scope, client, beforeCommitFollowUps)
}

internal class CaptureIdempotencyPayloadMismatchException(
    observationId: String
) : IllegalStateException("Capture payload does not match observation id: $observationId")
