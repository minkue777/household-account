import { createLedgerStatisticsQuery } from "../../src/read-side/reporting/application/queries/getLedgerStatistics";
import type { LedgerStatisticsSourcePort } from "../../src/read-side/reporting/application/ports/ledgerStatisticsSource";
import type {
  LedgerStatisticsQuery,
  LedgerStatisticsResult,
  ReportingCategoryReference,
} from "../../src/read-side/reporting/public";
import type { LedgerStatisticsSourceResult } from "../../src/read-side/reporting/model/ledgerStatistics";

export function createLedgerStatisticsFixtureSubject(fixture: {
  source: LedgerStatisticsSourceResult;
  categories?: readonly ReportingCategoryReference[];
}): LedgerStatisticsQuery {
  const source: LedgerStatisticsSourcePort = {
    read: async (): Promise<LedgerStatisticsSourceResult> => fixture.source,
  };
  return createLedgerStatisticsQuery(source, fixture.categories ?? []);
}

export type { LedgerStatisticsResult };
