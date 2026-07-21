export interface CaptureProvenance {
  source: string;
  originChannel: string;
  creatorMemberId: string;
  cardEvidence: string;
  captureLineageId: string;
  localCurrencyType?: string;
}

export interface LedgerTransformationTransaction {
  transactionId: string;
  lifecycleState: "active" | "superseded" | "deleted";
  amountInWon: number;
  merchant: string;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  cardDisplay: string;
  aggregateVersion: number;
  provenance: CaptureProvenance;
  mergeLeafIds?: readonly string[];
  intermediateMergeHistoryIds?: readonly string[];
}

export interface LedgerTransformationState {
  transactions: readonly LedgerTransformationTransaction[];
  dedupClaims: readonly {
    fingerprint: string;
    captureLineageId: string;
    state: "active" | "cancelled";
  }[];
  cancelledLineages: readonly {
    captureLineageId: string;
    fingerprint: string;
    cancelledAt: string;
    receiptRef: string;
  }[];
}

export type LedgerTransformationResult =
  | { kind: "success"; transactionIds: readonly string[] }
  | { kind: "conflict"; code: string }
  | { kind: "contract-failure"; code: string }
  | { kind: "retryable-failure"; code: string };
