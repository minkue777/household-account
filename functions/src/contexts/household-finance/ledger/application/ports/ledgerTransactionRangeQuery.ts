export interface LedgerTransactionRangeQuery {
  readonly householdId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly transactionType: "expense" | "income";
}

export interface LedgerTransactionRangeItem {
  readonly id: string;
  readonly aggregateVersion: number;
  readonly date: string;
  readonly time?: string;
  readonly merchant: string;
  readonly amount: number;
  readonly transactionType: "expense" | "income";
  readonly category: string;
  readonly cardType?: string;
  readonly cardDisplay?: string;
  readonly memo?: string;
  readonly mergedFrom?: readonly {
    readonly merchant: string;
    readonly amount: number;
    readonly category: string;
    readonly memo?: string;
  }[];
  readonly splitGroupId?: string;
  readonly splitIndex?: number;
  readonly splitTotal?: number;
}

export interface LedgerTransactionRangeQueryPort {
  list(
    query: LedgerTransactionRangeQuery,
  ): Promise<readonly LedgerTransactionRangeItem[]>;
}
