import type {
  DividendRefreshJobEvent,
  DividendRefreshJobResult,
  DividendRefreshSchedule,
  RefreshDisclosure,
} from "../../../domain/model/dividendRefreshJob";

export interface DividendRefreshJob {
  registeredSchedule(): DividendRefreshSchedule;
  runOccurrence(input: {
    scheduledFor: string;
    runId: string;
  }): Promise<DividendRefreshJobResult>;
  listDisclosures(): readonly RefreshDisclosure[];
  recordedEvents(): readonly DividendRefreshJobEvent[];
  annualProjection(year: number): {
    monthlyAmounts: readonly number[];
    eventIds: readonly string[];
  };
}
