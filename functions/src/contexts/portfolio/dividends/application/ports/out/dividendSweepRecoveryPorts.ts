import type {
  DividendCorrectionResult,
  DividendSweepReceipt,
  DividendSweepResult,
  PositionHistoryObservation,
  SweepDividendChangedEvent,
  SweepDividendEventView,
} from "../../../domain/model/dividendSweepRecovery";

export type PositionHistoryReadResult =
  | {
      kind: "ready";
      observations: readonly PositionHistoryObservation[];
      nextCursor?: string;
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

export interface PositionHistoryReader {
  page(input: {
    eventId: string;
    cursor?: string;
  }): Promise<PositionHistoryReadResult>;
}

export interface DividendSweepRecoveryStore {
  event(eventId: string): SweepDividendEventView | undefined;
  events(): readonly SweepDividendEventView[];
  occurrenceReceipt(occurrenceId: string): DividendSweepResult | undefined;
  correctionReceipt(idempotencyKey: string): DividendCorrectionResult | undefined;
  commitTransition(input: {
    occurrenceId: string;
    event: SweepDividendEventView;
    receipt: DividendSweepReceipt;
    changedEvent: SweepDividendChangedEvent;
  }): void;
  saveOccurrenceReceipt(
    occurrenceId: string,
    result: DividendSweepResult,
  ): void;
  commitCorrection(input: {
    idempotencyKey: string;
    event: SweepDividendEventView;
    result: DividendCorrectionResult;
    changedEvent: SweepDividendChangedEvent;
  }): void;
  receipts(): readonly DividendSweepReceipt[];
  changedEvents(): readonly SweepDividendChangedEvent[];
}
