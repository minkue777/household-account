import { describe, expect, it } from "vitest";
import { createHistoricalAssetDimensionsQuery } from "../../../../src/read-side/reporting/public";

type OwnerRefKey = "household" | `profile:${string}`;

interface HistoricalAssetSnapshot {
  snapshotDate: string;
  total: number;
  byType: Readonly<Record<string, number>>;
  byOwnerRefKey: Readonly<Partial<Record<OwnerRefKey, number>>>;
}

interface HistoricalAssetSourceWindow {
  baseline?: HistoricalAssetSnapshot;
  window: readonly HistoricalAssetSnapshot[];
  sourceCheckpoint: string;
}

interface HistoricalDimensionView {
  typeFilters: readonly { key: string; label: string }[];
  ownerFilters: readonly {
    key: OwnerRefKey;
    label: string;
    profileState: "active" | "archived" | "not-applicable";
  }[];
  selectedType: "ALL" | string;
  selectedOwner: "ALL" | OwnerRefKey;
  points: readonly HistoricalAssetSnapshot[];
  sourceCheckpoint: string;
}

type HistoricalAssetStatisticsResult =
  | { kind: "success"; value: HistoricalDimensionView }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

interface HistoricalAssetDimensionsSeed {
  sourcesByPeriodKey: Readonly<Record<string, HistoricalAssetSourceWindow>>;
  currentAssets: readonly {
    type: string;
    ownerRefKey: OwnerRefKey;
    lifecycle: "active" | "deleted";
  }[];
  ownerProfiles: readonly {
    ownerRefKey: OwnerRefKey;
    displayName: string;
    lifecycle: "active" | "archived";
  }[];
  typeLabels: Readonly<Record<string, string>>;
}

/** 기간 Snapshot에서 과거 type·owner filter를 구성하는 Reporting 계약입니다. */
export interface HistoricalAssetDimensionsSubject {
  getStatistics(input: {
    householdId: string;
    periodKey: string;
    selectedType: "ALL" | string;
    selectedOwner: "ALL" | OwnerRefKey;
  }): Promise<HistoricalAssetStatisticsResult>;
}

export function createSubject(
  seed: HistoricalAssetDimensionsSeed,
): HistoricalAssetDimensionsSubject {
  return createHistoricalAssetDimensionsQuery(seed);
}

const childOwner = "profile:child" as const;

const snapshot = (
  snapshotDate: string,
  stockAmount: number,
): HistoricalAssetSnapshot => ({
  snapshotDate,
  total: stockAmount,
  byType: { stock: stockAmount },
  byOwnerRefKey: { [childOwner]: stockAmount },
});

describe("Reporting 과거 자산 filter dimension 계약", () => {
  it("[T-STAT-AST-002][STAT-AST-003/AST-004/AST-009/DEC-058] 현재 deleted·archived여도 선택 기간 snapshot의 stock·명의자 filter와 0원을 보존한다", async () => {
    const subject = createSubject({
      sourcesByPeriodKey: {
        "2026-h1": {
          baseline: snapshot("2025-12-31", 100_000),
          window: [snapshot("2026-01-31", 100_000), snapshot("2026-02-28", 0)],
          sourceCheckpoint: "portfolio-history-91",
        },
      },
      currentAssets: [
        {
          type: "stock",
          ownerRefKey: childOwner,
          lifecycle: "deleted",
        },
      ],
      ownerProfiles: [
        {
          ownerRefKey: childOwner,
          displayName: "지아",
          lifecycle: "archived",
        },
      ],
      typeLabels: { stock: "주식" },
    });

    const result = await subject.getStatistics({
      householdId: "house-1",
      periodKey: "2026-h1",
      selectedType: "stock",
      selectedOwner: childOwner,
    });

    expect(result).toEqual({
      kind: "success",
      value: {
        typeFilters: [{ key: "stock", label: "주식" }],
        ownerFilters: [
          {
            key: childOwner,
            label: "지아",
            profileState: "archived",
          },
        ],
        selectedType: "stock",
        selectedOwner: childOwner,
        points: [
          snapshot("2025-12-31", 100_000),
          snapshot("2026-01-31", 100_000),
          snapshot("2026-02-28", 0),
        ],
        sourceCheckpoint: "portfolio-history-91",
      },
    });
  });

  it("[T-STAT-AST-002][STAT-AST-003/DEC-058] 기간 변경 후 기존 선택 dimension이 새 catalog에 없으면 전체로 초기화한다", async () => {
    const subject = createSubject({
      sourcesByPeriodKey: {
        old: {
          baseline: snapshot("2025-12-31", 100_000),
          window: [snapshot("2026-01-31", 0)],
          sourceCheckpoint: "old-window",
        },
        recent: {
          baseline: {
            snapshotDate: "2026-06-30",
            total: 500_000,
            byType: { property: 500_000 },
            byOwnerRefKey: { household: 500_000 },
          },
          window: [],
          sourceCheckpoint: "recent-window",
        },
      },
      currentAssets: [],
      ownerProfiles: [
        {
          ownerRefKey: childOwner,
          displayName: "지아",
          lifecycle: "archived",
        },
      ],
      typeLabels: { stock: "주식", property: "부동산" },
    });

    const oldPeriod = await subject.getStatistics({
      householdId: "house-1",
      periodKey: "old",
      selectedType: "stock",
      selectedOwner: childOwner,
    });
    expect(oldPeriod).toEqual({
      kind: "success",
      value: expect.objectContaining({
        selectedType: "stock",
        selectedOwner: childOwner,
      }),
    });

    const recentPeriod = await subject.getStatistics({
      householdId: "house-1",
      periodKey: "recent",
      selectedType: "stock",
      selectedOwner: childOwner,
    });

    expect(recentPeriod).toEqual({
      kind: "success",
      value: expect.objectContaining({
        typeFilters: [{ key: "property", label: "부동산" }],
        ownerFilters: [
          {
            key: "household",
            label: expect.any(String),
            profileState: "not-applicable",
          },
        ],
        selectedType: "ALL",
        selectedOwner: "ALL",
        sourceCheckpoint: "recent-window",
      }),
    });
  });
});
