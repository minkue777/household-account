import { describe, expect, it } from "vitest";

import { createHomeSummaryConfigurationFixture } from "../../../support/home-summary-configuration-fixture";

type HomeCardType =
  | "LOCAL_CURRENCY_BALANCE"
  | "MONTHLY_REMAINING_BUDGET"
  | "MONTHLY_EXPENSE"
  | "YEARLY_EXPENSE";

type SourceAmount =
  | { kind: "READY"; amountInWon: number; asOf: string }
  | { kind: "NO_DATA"; reason: string }
  | { kind: "FAILED"; code: string };

interface HomeConfigurationFixture {
  left: string;
  right: string;
  source: "SAVED" | "LEGACY";
}

interface HomeSummaryFixture {
  configuration?: HomeConfigurationFixture;
  sources?: Partial<Record<HomeCardType, SourceAmount>>;
  ledgerIncome?: { monthlyInWon: number; yearlyInWon: number };
}

interface HomeSummaryView {
  configurationSource: "DEFAULT" | "SAVED" | "LEGACY";
  cards: ReadonlyArray<{
    slot: "left" | "right";
    type: HomeCardType;
    state: SourceAmount;
  }>;
  income: { monthlyInWon: number; yearlyInWon: number };
  partial: boolean;
}

type GetHomeSummaryResult =
  | { kind: "success"; value: HomeSummaryView }
  | { kind: "contract-failure"; code: string };

export interface HomeSummaryConfigurationSubject {
  getSummary(input: {
    householdId: string;
    memberId: string;
    accountingMonth: string;
  }): Promise<GetHomeSummaryResult>;
}

export function createSubject(
  fixture: HomeSummaryFixture = {},
): HomeSummaryConfigurationSubject {
  return createHomeSummaryConfigurationFixture(fixture);
}

const query = {
  householdId: "house-1",
  memberId: "member-a",
  accountingMonth: "2026-07",
};

const ready = (amountInWon: number): SourceAmount => ({
  kind: "READY",
  amountInWon,
  asOf: "2026-07-20T09:00:00+09:00",
});

describe("Home Preferences 홈 구성·요약 계약", () => {
  it("[T-HOME-003][HOME-001] 저장값이 없으면 기본 순서의 서로 다른 두 카드를 반환한다", async () => {
    const result = await createSubject({
      sources: {
        LOCAL_CURRENCY_BALANCE: ready(50_000),
        MONTHLY_REMAINING_BUDGET: ready(120_000),
      },
      ledgerIncome: { monthlyInWon: 2_000_000, yearlyInWon: 14_000_000 },
    }).getSummary(query);

    expect(result).toEqual({
      kind: "success",
      value: {
        configurationSource: "DEFAULT",
        cards: [
          {
            slot: "left",
            type: "LOCAL_CURRENCY_BALANCE",
            state: ready(50_000),
          },
          {
            slot: "right",
            type: "MONTHLY_REMAINING_BUDGET",
            state: ready(120_000),
          },
        ],
        income: { monthlyInWon: 2_000_000, yearlyInWon: 14_000_000 },
        partial: false,
      },
    });
  });

  it.each(["SAVED", "LEGACY"] as const)(
    "[T-HOME-003][HOME-001] %s 구성의 카드 종류와 순서를 그대로 사용한다",
    async (source) => {
      const result = await createSubject({
        configuration: {
          left: "YEARLY_EXPENSE",
          right: "MONTHLY_EXPENSE",
          source,
        },
        sources: {
          YEARLY_EXPENSE: ready(7_000_000),
          MONTHLY_EXPENSE: ready(700_000),
        },
        ledgerIncome: { monthlyInWon: 1_000_000, yearlyInWon: 8_000_000 },
      }).getSummary(query);

      expect(result).toEqual({
        kind: "success",
        value: expect.objectContaining({
          configurationSource: source,
          cards: [
            {
              slot: "left",
              type: "YEARLY_EXPENSE",
              state: ready(7_000_000),
            },
            {
              slot: "right",
              type: "MONTHLY_EXPENSE",
              state: ready(700_000),
            },
          ],
          income: { monthlyInWon: 1_000_000, yearlyInWon: 8_000_000 },
        }),
      });
    },
  );

  it("[T-HOME-003][HOME-001/HOME-003] 한 카드 원천 실패를 0원으로 바꾸지 않고 다른 카드와 월·연 수입은 유지한다", async () => {
    const result = await createSubject({
      configuration: {
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
        source: "SAVED",
      },
      sources: {
        MONTHLY_EXPENSE: { kind: "FAILED", code: "LEDGER_TIMEOUT" },
        YEARLY_EXPENSE: ready(9_000_000),
      },
      ledgerIncome: { monthlyInWon: 0, yearlyInWon: 12_000_000 },
    }).getSummary(query);

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        cards: [
          {
            slot: "left",
            type: "MONTHLY_EXPENSE",
            state: { kind: "FAILED", code: "LEDGER_TIMEOUT" },
          },
          {
            slot: "right",
            type: "YEARLY_EXPENSE",
            state: ready(9_000_000),
          },
        ],
        income: { monthlyInWon: 0, yearlyInWon: 12_000_000 },
        partial: true,
      }),
    });
  });

  it("[T-HOME-003][HOME-001] 지원하지 않는 저장 카드 종류는 안전한 기본 구성으로 해석한다", async () => {
    const result = await createSubject({
      configuration: {
        left: "REMOVED_CARD_TYPE",
        right: "MONTHLY_EXPENSE",
        source: "LEGACY",
      },
      sources: {
        LOCAL_CURRENCY_BALANCE: ready(0),
        MONTHLY_REMAINING_BUDGET: ready(0),
      },
      ledgerIncome: { monthlyInWon: 0, yearlyInWon: 0 },
    }).getSummary(query);

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        configurationSource: "DEFAULT",
        cards: [
          expect.objectContaining({ type: "LOCAL_CURRENCY_BALANCE" }),
          expect.objectContaining({ type: "MONTHLY_REMAINING_BUDGET" }),
        ],
      }),
    });
  });

  it("[T-HOME-002][HOME-004] 기존 중복 구성은 읽기 호환으로 순서를 자동 보정하지 않는다", async () => {
    const result = await createSubject({
      configuration: {
        left: "MONTHLY_EXPENSE",
        right: "MONTHLY_EXPENSE",
        source: "SAVED",
      },
      sources: { MONTHLY_EXPENSE: ready(700_000) },
      ledgerIncome: { monthlyInWon: 0, yearlyInWon: 0 },
    }).getSummary(query);

    expect(result).toMatchObject({
      kind: "success",
      value: {
        configurationSource: "SAVED",
        cards: [
          { slot: "left", type: "MONTHLY_EXPENSE" },
          { slot: "right", type: "MONTHLY_EXPENSE" },
        ],
      },
    });
  });
});
