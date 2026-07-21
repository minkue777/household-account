import { describe, expect, it } from "vitest";
import { createDividendReadPoliciesFixture } from "../../support/dividend-read-policies-fixture";

interface DividendEventFact {
  eventId: string;
  instrumentCode: string;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
  status: "announced" | "fixed" | "paid";
  totalAmount?: number;
}

interface AnnualDividendView {
  monthlyAmounts: readonly number[];
  events: Readonly<Record<string, DividendEventFact>>;
  freshness: "fresh" | "stale";
}

type UpcomingResult =
  | {
      kind: "success";
      items: readonly {
        eventId: string;
        estimatedQuantity: number;
        estimatedAmount: number;
      }[];
    }
  | { kind: "retryable-failure"; code: string };

export interface DividendReadPoliciesSubject {
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
  }): UpcomingResult;
}

export function createSubject(): DividendReadPoliciesSubject {
  return createDividendReadPoliciesFixture();
}

const announced: DividendEventFact = {
  eventId: "event-a",
  instrumentCode: "069500",
  recordDate: "2026-08-10",
  paymentDate: "2026-08-20",
  perShareAmount: 100,
  status: "announced",
};

describe("배당 연간 조회와 예상 배당 정책 계약", () => {
  it("[T-DIV-004][DIV-001] 짧고 비정상인 legacy 월 배열을 12개월 0원 보정과 stale 상태로 읽는다", () => {
    const result = createSubject().normalizeAnnual({
      monthlyAmounts: [10, 20, Number.NaN, "invalid", 50, 60, 70, 80, 90, 100],
      events: {},
    });

    expect(result).toEqual({
      monthlyAmounts: [10, 20, 0, 0, 50, 60, 70, 80, 90, 100, 0, 0],
      events: {},
      freshness: "stale",
    });
  });

  it("[T-DIV-004][DIV-001/DIV-004] 정상 12개월 Event map은 canonical eventId key와 월 합계를 일치시킨다", () => {
    const paid: DividendEventFact = {
      ...announced,
      status: "paid",
      totalAmount: 1_000,
    };
    const result = createSubject().normalizeAnnual({
      monthlyAmounts: [0, 0, 0, 0, 0, 0, 0, 1_000, 0, 0, 0, 0],
      events: { "event-a": paid },
    });

    expect(result).toEqual({
      monthlyAmounts: [0, 0, 0, 0, 0, 0, 0, 1_000, 0, 0, 0, 0],
      events: { "event-a": paid },
      freshness: "fresh",
    });
    expect(Object.keys(result.events)).toEqual(
      Object.values(result.events).map(({ eventId }) => eventId),
    );
  });

  it("[T-DIV-005][DIV-002] 기준일 전 announced Event는 현재 수량으로 예상액을 계산한다", () => {
    const result = createSubject().estimateUpcoming({
      asOfDate: "2026-08-01",
      announced: [announced],
      confirmed: [],
      holdings: { kind: "success", quantities: { "069500": 12 } },
    });

    expect(result).toEqual({
      kind: "success",
      items: [{ eventId: "event-a", estimatedQuantity: 12, estimatedAmount: 1_200 }],
    });
  });

  it("[T-DIV-005][DIV-002] 같은 canonical eventId의 fixed·paid만 예상에서 제외하고 우연히 같은 값인 다른 Event는 유지한다", () => {
    const result = createSubject().estimateUpcoming({
      asOfDate: "2026-08-01",
      announced: [announced, { ...announced, eventId: "event-b" }],
      confirmed: [{ ...announced, status: "fixed", totalAmount: 1_200 }],
      holdings: { kind: "success", quantities: { "069500": 12 } },
    });

    expect(result).toEqual({
      kind: "success",
      items: [{ eventId: "event-b", estimatedQuantity: 12, estimatedAmount: 1_200 }],
    });
  });

  it("[T-DIV-005][DIV-002] Holdings 실패를 빈 예상 목록으로 축약하지 않는다", () => {
    expect(
      createSubject().estimateUpcoming({
        asOfDate: "2026-08-01",
        announced: [announced],
        confirmed: [],
        holdings: {
          kind: "retryable-failure",
          code: "HOLDINGS_QUERY_UNAVAILABLE",
        },
      }),
    ).toEqual({
      kind: "retryable-failure",
      code: "HOLDINGS_QUERY_UNAVAILABLE",
    });
  });
});
