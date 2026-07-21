export interface DividendEventFact {
  eventId: string;
  instrumentCode: string;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
  status: "announced" | "fixed" | "paid";
  totalAmount?: number;
}

export interface AnnualDividendView {
  monthlyAmounts: readonly number[];
  events: Readonly<Record<string, DividendEventFact>>;
  freshness: "fresh" | "stale";
}

export type UpcomingDividendResult =
  | {
      kind: "success";
      items: readonly {
        eventId: string;
        estimatedQuantity: number;
        estimatedAmount: number;
      }[];
    }
  | { kind: "retryable-failure"; code: string };
