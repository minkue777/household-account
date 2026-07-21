import { describe, expect, it } from "vitest";
import { queryAssetStatisticsPeriod } from "../../../../src/read-side/reporting/public";

type AssetType = "stock" | "fund" | "crypto" | "property" | "loan";
type AssetPeriodPreset =
  | "LAST_3_MONTHS"
  | "LAST_6_MONTHS"
  | "LAST_1_YEAR"
  | "ALL";

interface AssetStatisticsPoint {
  date: string;
  valuesByType: Partial<Record<AssetType, number>>;
}

interface AssetStatisticsFixture {
  today: string;
  snapshots: readonly AssetStatisticsPoint[];
}

type AssetStatisticsResult =
  | {
      kind: "success";
      period: { startDate: string; endDate: string };
      totals: ReadonlyArray<{ date: string; amountInWon: number }>;
    }
  | { kind: "no-data" };

export interface AssetStatisticsPeriodFilterSubject {
  getStatistics(input?: {
    preset?: AssetPeriodPreset;
    financialOnly?: boolean;
  }): Promise<AssetStatisticsResult>;
}

export function createSubject(
  fixture: AssetStatisticsFixture,
): AssetStatisticsPeriodFilterSubject {
  return {
    getStatistics: async (input) => queryAssetStatisticsPeriod(fixture, input),
  };
}

const snapshots: readonly AssetStatisticsPoint[] = [
  {
    date: "2019-12-31",
    valuesByType: { stock: 100, property: 1_000, loan: -200 },
  },
  {
    date: "2025-08-01",
    valuesByType: { stock: 120, property: 1_200, loan: -220 },
  },
  {
    date: "2026-02-01",
    valuesByType: { stock: 150, property: 1_500, loan: -250 },
  },
  {
    date: "2026-05-01",
    valuesByType: { stock: 200, fund: 300, property: 2_000, loan: -400 },
  },
  {
    date: "2026-07-20",
    valuesByType: { stock: 250, fund: 350, property: 2_100, loan: -300 },
  },
];

describe("Reporting 자산 통계 기간·금융자산 필터 계약", () => {
  it("[T-STAT-AST-003][STAT-AST-001] 기간 입력이 없으면 현재 월을 포함한 최근 3개월을 사용한다", async () => {
    const result = await createSubject({
      today: "2026-07-20",
      snapshots,
    }).getStatistics();

    expect(result).toEqual({
      kind: "success",
      period: { startDate: "2026-05-01", endDate: "2026-07-31" },
      totals: [
        { date: "2026-05-01", amountInWon: 2_100 },
        { date: "2026-07-20", amountInWon: 2_400 },
      ],
    });
  });

  it.each([
    {
      preset: "LAST_6_MONTHS" as const,
      period: { startDate: "2026-02-01", endDate: "2026-07-31" },
      firstPoint: { date: "2026-02-01", amountInWon: 1_400 },
    },
    {
      preset: "LAST_1_YEAR" as const,
      period: { startDate: "2025-08-01", endDate: "2026-07-31" },
      firstPoint: { date: "2025-08-01", amountInWon: 1_100 },
    },
  ])(
    "[T-STAT-AST-003][STAT-AST-001] $preset은 현재 월을 포함한 정확한 월 경계와 snapshot 범위를 사용한다",
    async ({ preset, period: expectedPeriod, firstPoint }) => {
      const result = await createSubject({
        today: "2026-07-20",
        snapshots,
      }).getStatistics({ preset });

      expect(result).toEqual({
        kind: "success",
        period: expectedPeriod,
        totals: expect.arrayContaining([firstPoint]),
      });
      if (result.kind === "success") {
        expect(result.totals[0]).toEqual(firstPoint);
      }
    },
  );

  it("[T-STAT-AST-003][STAT-AST-001] ALL은 고정 연도가 아니라 가장 오래된 유효 snapshot부터 시작한다", async () => {
    const result = await createSubject({
      today: "2026-07-20",
      snapshots,
    }).getStatistics({ preset: "ALL" });

    expect(result).toEqual({
      kind: "success",
      period: { startDate: "2019-12-31", endDate: "2026-07-20" },
      totals: expect.arrayContaining([
        { date: "2019-12-31", amountInWon: 900 },
      ]),
    });
  });

  it("[T-STAT-AST-003][STAT-AST-001] 금융자산 전용은 부동산과 대출만 제외하고 다른 자산 유형을 합산한다", async () => {
    const result = await createSubject({
      today: "2026-07-20",
      snapshots,
    }).getStatistics({ preset: "LAST_3_MONTHS", financialOnly: true });

    expect(result).toEqual({
      kind: "success",
      period: { startDate: "2026-05-01", endDate: "2026-07-31" },
      totals: [
        { date: "2026-05-01", amountInWon: 500 },
        { date: "2026-07-20", amountInWon: 600 },
      ],
    });
  });

  it("[T-STAT-AST-003][STAT-AST-001] 유효 snapshot이 하나도 없으면 임의 시작일의 0원 통계를 만들지 않는다", async () => {
    const result = await createSubject({
      today: "2026-07-20",
      snapshots: [],
    }).getStatistics({ preset: "ALL" });

    expect(result).toEqual({ kind: "no-data" });
  });
});
