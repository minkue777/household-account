import type {
  CapturedLineageCancellationResult,
  CapturedLineageCancellationState,
} from "../../domain/model/capturedLineageCancellation";

export interface CapturedLineageCancellationStore {
  findReceipt(
    cancellationKey: string,
  ): Promise<CapturedLineageCancellationResult | undefined>;
  load(): Promise<
    | { kind: "ready"; value: CapturedLineageCancellationState }
    | { kind: "RetryableFailure"; code: string }
  >;
  commit(input: {
    cancellationKey: string;
    state: CapturedLineageCancellationState;
    result: Extract<
      CapturedLineageCancellationResult,
      { kind: "Cancelled" }
    >;
  }): Promise<
    | { kind: "success" }
    | { kind: "RetryableFailure"; code: string }
  >;
}

export interface CapturedLineageCancellationClock {
  now(): string;
}
