export interface LocalCurrencyLedgerRow {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded" | "deleted";
  amountInWon: number;
  localCurrencyType?: string;
  aggregateVersion: number;
}

export interface LocalCurrencyLedgerState {
  transactions: readonly LocalCurrencyLedgerRow[];
}

export type LocalCurrencyLedgerQueryResult =
  | { kind: "success"; transactionIds: readonly string[] }
  | { kind: "no-data" }
  | { kind: "validation-error"; code: string }
  | { kind: "retryable-failure"; code: string };

export type LocalCurrencyLedgerMutationResult =
  | { kind: "success"; transactionIds: readonly string[] }
  | { kind: "conflict"; code: string }
  | { kind: "validation-error"; code: string };
