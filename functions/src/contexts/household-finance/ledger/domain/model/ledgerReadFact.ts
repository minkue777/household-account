export interface StoredLedgerReadRow {
  transactionId: string;
  householdId: string;
  transactionType?: string;
  lifecycleState?: "active" | "superseded" | "deleted";
  accountingDate: string;
  localTime: string;
  amountInWon: number;
}
