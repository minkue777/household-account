import type { RecurringLedgerPosting, RecurringLedgerRecordedEvent } from "../../../ledger/public";

export interface RecurringProcessPlan {
  readonly householdId: string;
  readonly planId: string;
  readonly merchant: string;
  readonly amountInWon: number;
  readonly categoryId: string;
  readonly dayOfMonth: number;
  readonly memo: string;
  readonly active: boolean;
  readonly creatorMemberId: string;
  readonly firstApplicableMonth: string;
  readonly processedThroughMonth?: string;
  readonly version: number;
}

export interface RecurringExecution {
  readonly executionKey: string;
  readonly planId: string;
  readonly targetMonth: string;
  readonly effectiveDate: string;
  readonly status: "completed";
  readonly ledgerTransactionId: string;
  readonly processedAt: string;
  readonly version: number;
}

export interface RecurringProcessReceipt {
  readonly idempotencyKey: string;
  readonly payloadSignature: string;
  readonly ledgerTransactionId: string;
}

export type RecurringProcessingEvent = RecurringLedgerRecordedEvent | {
  readonly eventType: "RecurringPlanProcessed.v1";
  readonly eventId: string;
  readonly planId: string;
  readonly targetMonth: string;
  readonly transactionId: string;
};

export interface RecurringProcessingState {
  readonly plans: readonly RecurringProcessPlan[];
  readonly executions: readonly RecurringExecution[];
  readonly ledgerTransactions: readonly RecurringLedgerPosting[];
  readonly receipts: readonly RecurringProcessReceipt[];
  readonly outboxEvents: readonly RecurringProcessingEvent[];
}

export type ProcessRecurringTargetResult =
  | {
      readonly kind: "created";
      readonly planId: string;
      readonly targetMonth: string;
      readonly effectiveDate: string;
      readonly ledgerTransactionId: string;
    }
  | {
      readonly kind: "already-processed";
      readonly planId: string;
      readonly targetMonth: string;
      readonly ledgerTransactionId: string;
    }
  | {
      readonly kind: "no-data";
      readonly planId: string;
      readonly targetMonth?: string;
      readonly reason: "INACTIVE_PLAN" | "NOT_DUE" | "NON_POSITIVE_PLAN_AMOUNT";
    }
  | {
      readonly kind: "retryable-failure";
      readonly planId: string;
      readonly targetMonth: string;
      readonly code: string;
    };

export type RecurringProcessingDecision =
  | { readonly kind: "return"; readonly result: ProcessRecurringTargetResult }
  | {
      readonly kind: "commit";
      readonly nextState: RecurringProcessingState;
      readonly result: ProcessRecurringTargetResult;
      readonly events: readonly RecurringProcessingEvent[];
    };
