import type {
  AnnualDividendView,
  DividendEventFact,
  UpcomingDividendResult,
} from "../../../domain/model/dividendRead";

export interface DividendReadPolicies {
  normalizeAnnual(input: {
    monthlyAmounts: readonly unknown[];
    events: Readonly<Record<string, DividendEventFact>>;
  }): AnnualDividendView;
  estimateUpcoming(input: {
    asOfDate: string;
    announced: readonly DividendEventFact[];
    confirmed: readonly DividendEventFact[];
    holdings:
      | { kind: "success"; quantities: Readonly<Record<string, number>> }
      | { kind: "retryable-failure"; code: string };
  }): UpcomingDividendResult;
}
