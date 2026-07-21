export interface PositionHistoryObservation {
  assetId: string;
  instrumentCode: string;
  snapshotDate: string;
  quantity: number;
  observedAt: string;
  sourceVersion: string;
}

export interface SweepDividendEventView {
  eventId: string;
  householdId: string;
  sourceDisclosureId: string;
  sourceAssetIds: readonly string[];
  instrumentCode: string;
  recordDate: string;
  paymentDate: string;
  perShareAmountInWon: number;
  status: "announced" | "fixed" | "paid";
  eligibleQuantity?: number;
  totalAmountInWon?: number;
  aggregateVersion: number;
}

export interface EligibilityEvidence {
  assetId: string;
  selectedSnapshotDate: string;
  selectedObservedAt: string;
  sourceVersion: string;
  quantity: number;
  selectionKind: "exact" | "nearest";
}

export type RecoverEligibilityResult =
  | {
      kind: "success";
      eventId: string;
      eligibleQuantity: number;
      evidence: readonly EligibilityEvidence[];
    }
  | { kind: "no-data"; code: "POSITION_HISTORY_NOT_OBSERVED" }
  | { kind: "retryable-failure"; code: string };

export interface DividendSweepReceipt {
  receiptId: string;
  occurrenceId: string;
  eventId: string;
  fromStatus: SweepDividendEventView["status"];
  toStatus: SweepDividendEventView["status"];
  resultingVersion: number;
}

export interface SweepDividendChangedEvent {
  eventType: "DividendEventChanged.v1";
  eventId: string;
  aggregateVersion: number;
  status: SweepDividendEventView["status"];
}

export interface DividendSweepResult {
  kind: "complete" | "partial-failure";
  occurrenceId: string;
  pageReceipts: readonly {
    pageNumber: number;
    eventIds: readonly string[];
    checkpointAfter?: string;
    terminal: true;
  }[];
  changedEventIds: readonly string[];
  retryableFailures: readonly { eventId: string; code: string }[];
}

export type DividendCorrectionResult =
  | { kind: "success"; event: SweepDividendEventView }
  | {
      kind: "already-processed";
      code: "PAID_DIVIDEND_IMMUTABLE";
    };
