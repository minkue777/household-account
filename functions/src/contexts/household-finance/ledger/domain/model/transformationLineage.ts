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
  transactionType: "expense" | "income";
  lifecycleState: "active" | "superseded" | "deleted";
  amountInWon: number;
  merchant: string;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  cardDisplay: string;
  cardType: string;
  aggregateVersion: number;
  provenance: CaptureProvenance;
  legacyMergeSnapshotPresent?: boolean;
  mergeLeafIds?: readonly string[];
  intermediateMergeHistoryIds?: readonly string[];
  splitGroupId?: string;
  splitIndex?: number;
  splitTotal?: number;
  splitOriginalId?: string;
  derivedFromTransactionId?: string;
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
  | {
      kind: "success";
      transactionIds: readonly string[];
      transactions?: readonly LedgerTransformationTransaction[];
    }
  | { kind: "conflict"; code: string }
  | { kind: "contract-failure"; code: string }
  | { kind: "retryable-failure"; code: string };
