export interface LedgerSearchableTransaction {
  transactionId: string;
  householdId: string;
  transactionType: "expense" | "income";
  lifecycleState: "active" | "superseded" | "deleted";
  accountingDate: string;
  localTime: string;
  merchant: string;
  memo: string;
  amountInWon: number;
  cardEvidence?: {
    companyCode: string;
    standardLabel: string;
    cardType: string;
    lastFour?: string;
  };
}

export interface SearchCardDefinition {
  companyCode: string;
  aliases: readonly string[];
  cardTypeAliases: Readonly<Record<string, readonly string[]>>;
}

export type LedgerDetailedSearchResult =
  | {
      kind: "Page";
      transactionIds: readonly string[];
      nextCursor?: string;
      sourceRevision: string;
      matchedTotalCount: number;
    }
  | { kind: "NoData" }
  | {
      kind: "ValidationError";
      code: "QUERY_REQUIRED" | "INVALID_PERIOD" | "INVALID_LIMIT";
    }
  | { kind: "Conflict"; code: "CURSOR_SCOPE_MISMATCH" }
  | { kind: "RetryableFailure"; code: string };
