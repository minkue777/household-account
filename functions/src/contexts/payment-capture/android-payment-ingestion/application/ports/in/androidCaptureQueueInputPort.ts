import type {
  EnqueueCaptureObservationInput,
  EnqueueCaptureObservationResult,
  FlushCaptureQueueResult,
} from "../../../domain/model/androidCaptureQueue";

export interface AndroidCaptureQueueInputPort {
  enqueue(
    input: EnqueueCaptureObservationInput,
  ): EnqueueCaptureObservationResult;
  flush(input: { readonly now: string }): FlushCaptureQueueResult;
  changeSession(actor: {
    readonly householdId: string;
    readonly memberId: string;
  }): void;
  logout(): void;
  discardUnreadableQueue(
    reason: "KeyInvalidated" | "DecryptionFailed",
  ): void;
}
