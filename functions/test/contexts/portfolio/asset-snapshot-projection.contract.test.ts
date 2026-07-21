import { describe, expect, it } from "vitest";

import { createAssetSnapshotProjectionFixture } from "../../support/asset-snapshot-projection-fixture";

interface SnapshotProjectionView {
  readonly total: number;
  readonly financial: number;
  readonly byType: Readonly<Record<string, number>>;
  readonly byOwnerRefKey: Readonly<Record<string, number>>;
}

export interface AssetSnapshotProjectionSubject {
  project(input: {
    householdId: string;
    localDate: string;
    sourceCheckpoint: string;
    calculatedAt: string;
  }): Promise<
    | { kind: "projected" | "replayed"; snapshot: SnapshotProjectionView }
    | { kind: "validation-error"; code: string; assetId: string }
    | { kind: "retryable-failure"; code: string }
  >;
}

export function createSubject(
  input: Parameters<typeof createAssetSnapshotProjectionFixture>[0],
) {
  return createAssetSnapshotProjectionFixture(input);
}

describe("AssetSnapshotProjector 계약", () => {
  it("[T-AST-004][AST-008/JOB-AST-002] 현재와 직전 dimension 합집합에 사라진 scope 0원을 기록합니다", async () => {
    const fixture = createSubject({
      current: {
        assets: [
          {
            assetId: "stock-child",
            type: "stock",
            ownerRef: { kind: "profile", profileId: "child" },
            currentBalance: 100,
            aggregateVersion: 3,
            lifecycleState: "active",
          },
          {
            assetId: "loan-household",
            type: "loan",
            ownerRef: { kind: "household" },
            currentBalance: 30,
            aggregateVersion: 2,
            lifecycleState: "active",
          },
          {
            assetId: "deleted-property",
            type: "property",
            ownerRef: { kind: "household" },
            currentBalance: 1_000,
            aggregateVersion: 4,
            lifecycleState: "deleted",
          },
        ],
        ownerDisplayNames: {
          "profile:child": "아이",
          household: "가구",
        },
      },
      previous: {
        localDate: "2026-07-20",
        total: 500,
        financial: 400,
        byType: { stock: 400, bond: 100 },
        byOwnerRefKey: { "profile:archived": 500 },
        ownerDisplayNames: { "profile:archived": "과거 명의자" },
      },
    });

    const first = await fixture.subject.project({
      householdId: "house-1",
      localDate: "2026-07-21",
      sourceCheckpoint: "asset-valuation-daily:2026-07-21:house-1",
      calculatedAt: "2026-07-21T23:55:00+09:00",
    });
    const replay = await fixture.subject.project({
      householdId: "house-1",
      localDate: "2026-07-21",
      sourceCheckpoint: "asset-valuation-daily:2026-07-21:house-1",
      calculatedAt: "2026-07-21T23:55:00+09:00",
    });

    expect(first.kind).toBe("projected");
    expect(replay.kind).toBe("replayed");
    expect(fixture.writeCount()).toBe(1);
    expect(fixture.snapshot()).toMatchObject({
      total: 70,
      financial: 100,
      byType: {
        bond: 0,
        stock: 100,
        loan: -30,
        savings: 0,
        crypto: 0,
        property: 0,
        gold: 0,
      },
      byOwnerRefKey: {
        household: -30,
        "profile:child": 100,
        "profile:archived": 0,
      },
      ownerDisplayNames: {
        household: "가구",
        "profile:child": "아이",
        "profile:archived": "과거 명의자",
      },
      sourceAssetVersions: {
        "stock-child": 3,
        "loan-household": 2,
      },
    });
  });

  it("[T-AST-004][AST-008] 자산이 0개여도 total·financial과 직전 scope의 명시적 0원을 저장합니다", async () => {
    const fixture = createSubject({
      current: { assets: [], ownerDisplayNames: {} },
      previous: {
        localDate: "2026-07-20",
        total: 300,
        financial: 300,
        byType: { stock: 300 },
        byOwnerRefKey: { "profile:gone": 300 },
        ownerDisplayNames: { "profile:gone": "과거 명의자" },
      },
    });

    const result = await fixture.subject.project({
      householdId: "empty-house",
      localDate: "2026-07-21",
      sourceCheckpoint: "asset-valuation-daily:2026-07-21:empty-house",
      calculatedAt: "2026-07-21T23:55:00+09:00",
    });

    expect(result.kind).toBe("projected");
    expect(fixture.snapshot()).toMatchObject({
      total: 0,
      financial: 0,
      byType: { stock: 0 },
      byOwnerRefKey: { "profile:gone": 0 },
    });
  });
});
