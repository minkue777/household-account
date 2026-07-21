import type { LedgerSearchSourceResult } from "../../domain/model/ledgerSearch";

export interface LedgerSearchSource {
  load(input: {
    householdId: string;
    memberId: string;
    transactionType: "expense" | "income";
    period: { startDate: string; endDate: string };
  }): Promise<LedgerSearchSourceResult>;
}
