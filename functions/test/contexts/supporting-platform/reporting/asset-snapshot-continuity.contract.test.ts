import { describe, expect, it } from "vitest";
import { createAssetSnapshotContinuityFixtureSubject } from "../../../support/asset-snapshot-continuity-fixture";

interface AssetSnapshotFact {
  snapshotDate: string;
  amountInWon: number;
  aggregateVersion: number;
}

type AssetSnapshotSourceFixture =
  | {
      kind: "ready";
      baseline?: AssetSnapshotFact;
      window: readonly AssetSnapshotFact[];
      sourceCheckpoint: string;
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

interface AssetStatisticsView {
  period: { startDate: string; endDate: string };
  points: ReadonlyArray<{ date: string; amountInWon: number }>;
  sourceCheckpoint: string;
}

type GetAssetStatisticsResult =
  | { kind: "success"; value: AssetStatisticsView }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

interface AssetSnapshotContinuityFixture {
  source: AssetSnapshotSourceFixture;
}

export interface AssetSnapshotContinuitySubject {
  getStatistics(input: {
    householdId: string;
    memberId: string;
    period: { startDate: string; endDate: string };
  }): Promise<GetAssetStatisticsResult>;
}

export function createSubject(
  fixture: AssetSnapshotContinuityFixture,
): AssetSnapshotContinuitySubject {
  return createAssetSnapshotContinuityFixtureSubject(fixture.source);
}

const period = { startDate: "2026-07-01", endDate: "2026-07-05" };

describe("Reporting 자산 스냅샷 연속성 공개 계약", () => {
  it("[T-STAT-AST-001][STAT-AST-002/DEC-048] 기간 시작 baseline과 중간 gap은 각각 직전 성공 스냅샷을 이어 표시한다", async () => {
    const result = await createSubject({
      source: {
        kind: "ready",
        baseline: {
          snapshotDate: "2026-06-30",
          amountInWon: 100_000,
          aggregateVersion: 11,
        },
        window: [
          {
            snapshotDate: "2026-07-03",
            amountInWon: 150_000,
            aggregateVersion: 12,
          },
        ],
        sourceCheckpoint: "portfolio-window-12",
      },
    }).getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({
      kind: "success",
      value: {
        period,
        points: [
          { date: "2026-07-01", amountInWon: 100_000 },
          { date: "2026-07-02", amountInWon: 100_000 },
          { date: "2026-07-03", amountInWon: 150_000 },
          { date: "2026-07-04", amountInWon: 150_000 },
          { date: "2026-07-05", amountInWon: 150_000 },
        ],
        sourceCheckpoint: "portfolio-window-12",
      },
    });
  });

  it("[T-STAT-AST-001][STAT-AST-002] 0원 baseline도 NoData가 아닌 유효값으로 이어 표시한다", async () => {
    const result = await createSubject({
      source: {
        kind: "ready",
        baseline: {
          snapshotDate: "2026-06-30",
          amountInWon: 0,
          aggregateVersion: 20,
        },
        window: [],
        sourceCheckpoint: "portfolio-zero",
      },
    }).getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({
      kind: "success",
      value: {
        period,
        points: [
          { date: "2026-07-01", amountInWon: 0 },
          { date: "2026-07-02", amountInWon: 0 },
          { date: "2026-07-03", amountInWon: 0 },
          { date: "2026-07-04", amountInWon: 0 },
          { date: "2026-07-05", amountInWon: 0 },
        ],
        sourceCheckpoint: "portfolio-zero",
      },
    });
  });

  it("[T-STAT-AST-001][STAT-AST-002] 이전 성공값이 없는 첫 스냅샷 이전 구간을 0원으로 추정하지 않는다", async () => {
    const result = await createSubject({
      source: {
        kind: "ready",
        window: [
          {
            snapshotDate: "2026-07-03",
            amountInWon: 150_000,
            aggregateVersion: 12,
          },
        ],
        sourceCheckpoint: "portfolio-no-baseline",
      },
    }).getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({
      kind: "success",
      value: {
        period,
        points: [
          { date: "2026-07-03", amountInWon: 150_000 },
          { date: "2026-07-04", amountInWon: 150_000 },
          { date: "2026-07-05", amountInWon: 150_000 },
        ],
        sourceCheckpoint: "portfolio-no-baseline",
      },
    });
  });

  it("[T-STAT-AST-001][STAT-005/STAT-AST-002] 유효 snapshot이 전혀 없으면 NoData를 반환한다", async () => {
    const result = await createSubject({
      source: { kind: "no-data" },
    }).getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({ kind: "no-data" });
  });

  it("[T-STAT-AST-001][STAT-005/STAT-AST-002] 저장소 실패를 NoData나 0원 series로 바꾸지 않는다", async () => {
    const result = await createSubject({
      source: {
        kind: "retryable-failure",
        code: "PORTFOLIO_SNAPSHOT_REPOSITORY_UNAVAILABLE",
      },
    }).getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "PORTFOLIO_SNAPSHOT_REPOSITORY_UNAVAILABLE",
    });
  });
});
