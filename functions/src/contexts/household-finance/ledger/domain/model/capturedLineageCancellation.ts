export interface CapturedMonthlyTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  amountInWon: number;
  captureLineageId: string;
  aggregateVersion: number;
  monthlyGroup?: {
    groupId: string;
    originalTransactionId: string;
    index: number;
    total: number;
  };
}

export interface CaptureClaim {
  fingerprint: string;
  captureLineageId: string;
  state: "active" | "cancelled";
  cancelledAt?: string;
}

export interface CapturedLineageCancellationState {
  transactions: readonly CapturedMonthlyTransaction[];
  claims: readonly CaptureClaim[];
  cancelledLineages: readonly {
    captureLineageId: string;
    receiptId: string;
  }[];
  events: readonly {
    eventName: "CapturedLineageCancelled.v1";
    deletedTransactionIds: readonly string[];
  }[];
}

export type CapturedLineageCancellationResult =
  | {
      kind: "Cancelled";
      captureLineageId: string;
      deletedTransactionIds: readonly string[];
    }
  | { kind: "AlreadyCancelled"; captureLineageId: string }
  | { kind: "NotFound" }
  | { kind: "Conflict"; code: string }
  | { kind: "RetryableFailure"; code: string };
