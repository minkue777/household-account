import { calculateLedgerStatistics } from "../../calculations/ledgerStatistics";
import type {
  LedgerStatisticsResult,
  ReportingCategoryReference,
} from "../../model/ledgerStatistics";
import type { LedgerStatisticsSourcePort } from "../ports/ledgerStatisticsSource";

export interface LedgerStatisticsQuery {
  getStatistics(input: {
    householdId: string;
    memberId: string;
    period: { startDate: string; endDate: string };
  }): Promise<LedgerStatisticsResult>;
}

export function createLedgerStatisticsQuery(
  source: LedgerStatisticsSourcePort,
  categories: readonly ReportingCategoryReference[],
): LedgerStatisticsQuery {
  return {
    getStatistics: async (input) => {
      const result = await source.read(input);
      if (result.kind !== "ready") return result;
      return calculateLedgerStatistics({
        source: result,
        categories,
        period: input.period,
      });
    },
  };
}
