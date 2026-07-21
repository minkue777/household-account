export interface MonthlyReconfigurationTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  cardDisplay: string;
  cardEvidence: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId: string;
  localCurrencyType?: string;
  aggregateVersion: number;
  monthlyGroup?: {
    groupId: string;
    originalTransactionId: string;
    index: number;
    total: number;
    groupVersion: number;
  };
}

export type MonthlyReconfigurationResult =
  | { kind: "Reconfigured"; activeTransactionIds: readonly string[] }
  | { kind: "ValidationError"; code: string }
  | { kind: "Conflict"; code: string }
  | { kind: "RetryableFailure"; code: string };
