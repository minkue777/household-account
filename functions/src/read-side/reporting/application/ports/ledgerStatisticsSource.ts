import type { LedgerStatisticsSourceResult } from "../../model/ledgerStatistics";

export interface LedgerStatisticsSourcePort {
  read(input: {
    householdId: string;
    memberId: string;
    period: { startDate: string; endDate: string };
  }): Promise<LedgerStatisticsSourceResult>;
}
