import { describe, expect, it } from "vitest";
import { createLedgerStatisticsFixtureSubject } from "../../../support/ledger-statistics-fixture";

type TransactionStatus = "active" | "cancelled" | "deleted" | "superseded";

interface LedgerStatisticsFact {
  transactionId: string;
  transactionType: "expense" | "income";
  status: TransactionStatus;
  accountingDate: string;
  amountInWon: number;
  categoryId: string;
}

interface CategoryReference {
  categoryId: string;
  label: string;
}

type LedgerSourceFixture =
  | {
      kind: "ready";
      sourceCheckpoint: string;
      observedAt: string;
      transactions: readonly LedgerStatisticsFact[];
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

interface LedgerStatisticsView {
  period: { startDate: string; endDate: string };
  totalExpenseInWon: number;
  monthly: ReadonlyArray<{ yearMonth: string; amountInWon: number }>;
  categories: ReadonlyArray<{
    categoryId: string;
    label: string;
    amountInWon: number;
    ratio: number;
  }>;
  sourceCheckpoint: string;
  updatedAt: string;
}

type GetLedgerStatisticsResult =
  | { kind: "success"; value: LedgerStatisticsView }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

interface LedgerStatisticsFixture {
  source: LedgerSourceFixture;
  categories?: readonly CategoryReference[];
}

/**
 * Reporting은 Ledger 저장 구조가 아니라 이 조회 사실과 결과만 소비합니다.
 * 카드 식별 문자열 검색과 검색 결과 합계는 Ledger 검색 계약이 소유하므로
 * 이 전용 통계 결과에 카드 dimension을 암묵적으로 추가하지 않습니다.
 */
export interface LedgerStatisticsSubject {
  getStatistics(input: {
    householdId: string;
    memberId: string;
    period: { startDate: string; endDate: string };
  }): Promise<GetLedgerStatisticsResult>;
}

export function createSubject(
  fixture: LedgerStatisticsFixture,
): LedgerStatisticsSubject {
  return createLedgerStatisticsFixtureSubject(fixture);
}

const period = { startDate: "2026-05-01", endDate: "2026-07-31" };

const transaction = (
  overrides: Partial<LedgerStatisticsFact> &
    Pick<LedgerStatisticsFact, "transactionId" | "accountingDate" | "amountInWon">,
): LedgerStatisticsFact => ({
  transactionType: "expense",
  status: "active",
  categoryId: "food",
  ...overrides,
});

describe("Reporting 지출 통계 공개 계약", () => {
  it("[T-STAT-003][STAT-002] 기간 내 활성 지출만 총액·월·카테고리별로 집계한다", async () => {
    const subject = createSubject({
      categories: [
        { categoryId: "food", label: "식비" },
        { categoryId: "childcare", label: "육아비" },
      ],
      source: {
        kind: "ready",
        sourceCheckpoint: "ledger-window-17",
        observedAt: "2026-07-19T12:00:00+09:00",
        transactions: [
          transaction({
            transactionId: "may-food",
            accountingDate: "2026-05-10",
            amountInWon: 20_000,
          }),
          transaction({
            transactionId: "june-childcare",
            accountingDate: "2026-06-20",
            amountInWon: 20_000,
            categoryId: "childcare",
          }),
          transaction({
            transactionId: "july-food",
            accountingDate: "2026-07-01",
            amountInWon: 60_000,
          }),
          transaction({
            transactionId: "income-is-not-expense",
            transactionType: "income",
            accountingDate: "2026-07-02",
            amountInWon: 1_000_000,
          }),
          transaction({
            transactionId: "cancelled",
            status: "cancelled",
            accountingDate: "2026-07-03",
            amountInWon: 300_000,
          }),
          transaction({
            transactionId: "outside-period",
            accountingDate: "2026-04-30",
            amountInWon: 500_000,
          }),
        ],
      },
    });

    const result = await subject.getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        period,
        totalExpenseInWon: 100_000,
        monthly: [
          { yearMonth: "2026-05", amountInWon: 20_000 },
          { yearMonth: "2026-06", amountInWon: 20_000 },
          { yearMonth: "2026-07", amountInWon: 60_000 },
        ],
        sourceCheckpoint: "ledger-window-17",
        updatedAt: "2026-07-19T12:00:00+09:00",
      }),
    });
    if (result.kind !== "success") {
      throw new Error("집계 성공 계약을 기대했습니다.");
    }
    expect(result.value.categories).toHaveLength(2);
    expect(result.value.categories).toEqual(
      expect.arrayContaining([
        {
          categoryId: "food",
          label: "식비",
          amountInWon: 80_000,
          ratio: 0.8,
        },
        {
          categoryId: "childcare",
          label: "육아비",
          amountInWon: 20_000,
          ratio: 0.2,
        },
      ]),
    );
  });

  it("[T-STAT-003][STAT-002] 거래가 없는 월도 기간의 결정적 0원 bucket으로 유지한다", async () => {
    const result = await createSubject({
      source: {
        kind: "ready",
        sourceCheckpoint: "ledger-window-18",
        observedAt: "2026-07-19T12:00:00+09:00",
        transactions: [
          transaction({
            transactionId: "july-only",
            accountingDate: "2026-07-01",
            amountInWon: 10_000,
          }),
        ],
      },
    }).getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        totalExpenseInWon: 10_000,
        monthly: [
          { yearMonth: "2026-05", amountInWon: 0 },
          { yearMonth: "2026-06", amountInWon: 0 },
          { yearMonth: "2026-07", amountInWon: 10_000 },
        ],
      }),
    });
  });

  it("[T-STAT-001][STAT-005] 권위 원천이 READY 0원을 반환하면 NoData가 아닌 성공한 0원 통계다", async () => {
    const result = await createSubject({
      source: {
        kind: "ready",
        sourceCheckpoint: "authoritative-zero",
        observedAt: "2026-07-19T12:00:00+09:00",
        transactions: [],
      },
    }).getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        totalExpenseInWon: 0,
        monthly: [
          { yearMonth: "2026-05", amountInWon: 0 },
          { yearMonth: "2026-06", amountInWon: 0 },
          { yearMonth: "2026-07", amountInWon: 0 },
        ],
        categories: [],
      }),
    });
  });

  it("[T-STAT-001][STAT-005] 데이터 없음은 성공한 빈 통계로 바꾸지 않는다", async () => {
    const result = await createSubject({
      source: { kind: "no-data" },
    }).getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({ kind: "no-data" });
  });

  it.each([
    ["retryable-failure", "LEDGER_REPOSITORY_UNAVAILABLE"],
    ["contract-failure", "LEDGER_SOURCE_SCHEMA_INVALID"],
  ] as const)(
    "[T-STAT-001][STAT-005] 원천 %s는 NoData·0원으로 위장하지 않고 typed failure를 보존한다",
    async (kind, code) => {
      const result = await createSubject({
        source: { kind, code },
      }).getStatistics({
        householdId: "house-1",
        memberId: "member-a",
        period,
      });

      expect(result).toEqual({ kind, code });
    },
  );
});
