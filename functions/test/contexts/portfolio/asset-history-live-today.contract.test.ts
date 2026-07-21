import { describe, expect, it } from "vitest";
import { queryAssetHistory } from "../../../src/contexts/portfolio/core/public";

interface HistoryPoint {
  localDate: string;
  amountInWon: number;
  source: "stored-snapshot" | "live-today";
}

type AssetHistoryResult =
  | { kind: "success"; points: readonly HistoryPoint[] }
  | { kind: "no-data" };

export interface AssetHistoryLiveTodaySubject {
  query(input: {
    period: { startDate: string; endDate: string };
    storedPoints: readonly HistoryPoint[];
    liveToday?: HistoryPoint;
  }): AssetHistoryResult;
}

export function createSubject(): AssetHistoryLiveTodaySubject {
  return { query: queryAssetHistory };
}

const period = { startDate: "2026-07-18", endDate: "2026-07-20" };

describe("Portfolio 저장 이력과 오늘 실시간 point 합성 계약", () => {
  it("[T-AST-009][AST-005] 오늘 저장 snapshot과 실시간 잔액이 함께 있으면 live-today 한 점으로 치환한다", () => {
    const result = createSubject().query({
      period,
      storedPoints: [
        {
          localDate: "2026-07-20",
          amountInWon: 100_000,
          source: "stored-snapshot",
        },
      ],
      liveToday: {
        localDate: "2026-07-20",
        amountInWon: 120_000,
        source: "live-today",
      },
    });

    expect(result).toEqual({
      kind: "success",
      points: [
        {
          localDate: "2026-07-20",
          amountInWon: 120_000,
          source: "live-today",
        },
      ],
    });
  });

  it("[T-AST-009][AST-005/DEC-048] 최초 snapshot 전은 비우고 이후 gap은 명시적 0원을 포함한 직전 값을 이어 표시한다", () => {
    const result = createSubject().query({
      period: { startDate: "2026-07-17", endDate: "2026-07-21" },
      storedPoints: [
        {
          localDate: "2026-07-18",
          amountInWon: 50_000,
          source: "stored-snapshot",
        },
        {
          localDate: "2026-07-20",
          amountInWon: 0,
          source: "stored-snapshot",
        },
      ],
    });

    expect(result).toEqual({
      kind: "success",
      points: [
        {
          localDate: "2026-07-18",
          amountInWon: 50_000,
          source: "stored-snapshot",
        },
        {
          localDate: "2026-07-19",
          amountInWon: 50_000,
          source: "stored-snapshot",
        },
        {
          localDate: "2026-07-20",
          amountInWon: 0,
          source: "stored-snapshot",
        },
        {
          localDate: "2026-07-21",
          amountInWon: 0,
          source: "stored-snapshot",
        },
      ],
    });
  });
});
