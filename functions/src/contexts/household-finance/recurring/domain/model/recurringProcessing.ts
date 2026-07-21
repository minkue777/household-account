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

export interface RecurringLedgerTransaction {
  readonly transactionId: string;
  readonly recurringPlanId: string;
  readonly recurringTargetMonth: string;
  readonly transactionType: "expense";
  readonly source: "recurring";
  readonly originChannel: "recurring";
  readonly creatorMemberId: string;
  readonly merchant: string;
  readonly amountInWon: number;
  readonly categoryId: string;
  readonly memo: string;
  readonly accountingDate: string;
}

export interface RecurringProcessReceipt {
  readonly idempotencyKey: string;
  readonly payloadSignature: string;
  readonly ledgerTransactionId: string;
}

export interface RecurringProcessingEvent {
  readonly eventType: "TransactionRecorded.v1" | "RecurringPlanProcessed.v1";
  readonly eventId: string;
  readonly planId: string;
  readonly targetMonth: string;
  readonly transactionId: string;
}

export interface RecurringProcessingState {
  readonly plans: readonly RecurringProcessPlan[];
  readonly executions: readonly RecurringExecution[];
  readonly ledgerTransactions: readonly RecurringLedgerTransaction[];
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
