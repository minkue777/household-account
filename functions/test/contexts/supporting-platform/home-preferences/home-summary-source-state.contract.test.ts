import { describe, expect, it } from "vitest";

import { createHomeSummarySourceStateFixture } from "../../../support/home-summary-source-state-fixture";

type HomeCardType =
  | "LOCAL_CURRENCY_BALANCE"
  | "MONTHLY_REMAINING_BUDGET"
  | "MONTHLY_EXPENSE"
  | "YEARLY_EXPENSE";

type HomeSourceResult =
  | { kind: "ready"; amountInWon: number; asOf: string }
  | { kind: "no-data"; reason: string }
  | { kind: "retryable-failure"; code: string };

type HomeCardState =
  | { kind: "READY"; amountInWon: number; asOf: string }
  | { kind: "NO_DATA"; reason: string }
  | { kind: "FAILED"; code: string; retryable: true };

interface HomeSummaryView {
  cards: readonly {
    slot: "left" | "right";
    cardType: HomeCardType;
    state: HomeCardState;
  }[];
  overall: "COMPLETE" | "PARTIAL";
}

interface HomeSummarySeed {
  configuration: { left: HomeCardType; right: HomeCardType };
  sources: Readonly<Partial<Record<HomeCardType, HomeSourceResult>>>;
}

/** 원천의 typed 상태를 카드별로 보존하는 Home Summary 공개 Query 계약입니다. */
export interface HomeSummarySourceStateSubject {
  getSummary(input: {
    householdId: string;
    memberId: string;
    period: { year: number; month: number };
  }): Promise<{ kind: "success"; value: HomeSummaryView }>;
}

export function createSubject(
  seed: HomeSummarySeed,
): HomeSummarySourceStateSubject {
  return createHomeSummarySourceStateFixture(seed);
}

const query = {
  householdId: "house-1",
  memberId: "member-a",
  period: { year: 2026, month: 7 },
};

describe("Home Summary 원천 상태 보존 계약", () => {
  it("[T-HOME-001][HOME-003/DEC-048] 유효한 0원과 NoData를 서로 바꾸지 않고 카드 순서를 유지한다", async () => {
    const result = await createSubject({
      configuration: {
        left: "LOCAL_CURRENCY_BALANCE",
        right: "MONTHLY_REMAINING_BUDGET",
      },
      sources: {
        LOCAL_CURRENCY_BALANCE: {
          kind: "ready",
          amountInWon: 0,
          asOf: "2026-07-20T12:00:00+09:00",
        },
        MONTHLY_REMAINING_BUDGET: {
          kind: "no-data",
          reason: "MONTHLY_BUDGET_NOT_CONFIGURED",
        },
      },
    }).getSummary(query);

    expect(result).toEqual({
      kind: "success",
      value: {
        cards: [
          {
            slot: "left",
            cardType: "LOCAL_CURRENCY_BALANCE",
            state: {
              kind: "READY",
              amountInWon: 0,
              asOf: "2026-07-20T12:00:00+09:00",
            },
          },
          {
            slot: "right",
            cardType: "MONTHLY_REMAINING_BUDGET",
            state: {
              kind: "NO_DATA",
              reason: "MONTHLY_BUDGET_NOT_CONFIGURED",
            },
          },
        ],
        overall: "PARTIAL",
      },
    });
  });

  it("[T-HOME-001][HOME-003] 한 원천의 RetryableFailure를 0원으로 위장하지 않고 다른 정상 카드를 유지한다", async () => {
    const result = await createSubject({
      configuration: {
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
      },
      sources: {
        MONTHLY_EXPENSE: {
          kind: "retryable-failure",
          code: "LEDGER_REPOSITORY_UNAVAILABLE",
        },
        YEARLY_EXPENSE: {
          kind: "ready",
          amountInWon: 1_200_000,
          asOf: "2026-07-20T12:00:00+09:00",
        },
      },
    }).getSummary(query);

    expect(result).toEqual({
      kind: "success",
      value: {
        cards: [
          {
            slot: "left",
            cardType: "MONTHLY_EXPENSE",
            state: {
              kind: "FAILED",
              code: "LEDGER_REPOSITORY_UNAVAILABLE",
              retryable: true,
            },
          },
          {
            slot: "right",
            cardType: "YEARLY_EXPENSE",
            state: {
              kind: "READY",
              amountInWon: 1_200_000,
              asOf: "2026-07-20T12:00:00+09:00",
            },
          },
        ],
        overall: "PARTIAL",
      },
    });
  });

  it("[T-HOME-001][HOME-003] 두 원천의 정상 0원은 완전한 성공 요약이다", async () => {
    const result = await createSubject({
      configuration: {
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
      },
      sources: {
        MONTHLY_EXPENSE: {
          kind: "ready",
          amountInWon: 0,
          asOf: "2026-07-20T12:00:00+09:00",
        },
        YEARLY_EXPENSE: {
          kind: "ready",
          amountInWon: 0,
          asOf: "2026-07-20T12:00:00+09:00",
        },
      },
    }).getSummary(query);

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        overall: "COMPLETE",
        cards: expect.arrayContaining([
          expect.objectContaining({
            cardType: "MONTHLY_EXPENSE",
            state: expect.objectContaining({ kind: "READY", amountInWon: 0 }),
          }),
          expect.objectContaining({
            cardType: "YEARLY_EXPENSE",
            state: expect.objectContaining({ kind: "READY", amountInWon: 0 }),
          }),
        ]),
      }),
    });
  });
});
