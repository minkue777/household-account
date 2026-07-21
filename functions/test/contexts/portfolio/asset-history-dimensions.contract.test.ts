import { describe, expect, it } from "vitest";
import type {
  AssetHistoryInputPort,
  AssetHistoryPointV1,
  AssetOwnerRefKey,
} from "../../../src/contexts/portfolio/core/public";
import {
  createAssetHistoryDimensionFixture,
  type AssetHistoryDimensionSeed,
} from "../../support/asset-history-dimensions-fixture";

export interface AssetHistoryDimensionSubject extends AssetHistoryInputPort {}

export function createSubject(
  seed: AssetHistoryDimensionSeed,
): AssetHistoryDimensionSubject {
  return createAssetHistoryDimensionFixture(seed);
}

const ownerRefKey = "profile:child-profile" as const;
const period = { startDate: "2026-07-01", endDate: "2026-07-03" };

const point = (
  localDate: string,
  stockAmount: number,
  ownerKey: AssetOwnerRefKey = ownerRefKey,
): AssetHistoryPointV1 => ({
  localDate,
  total: stockAmount,
  financial: stockAmount,
  byType: { stock: stockAmount },
  byOwnerRefKey: { [ownerKey]: stockAmount },
  source: "stored-snapshot",
});

describe("Portfolio 과거 자산 dimension 공개 계약", () => {
  it("[T-AST-006][AST-004/AST-006/AST-009/DEC-058] 현재 삭제된 자산과 보관된 명의자라도 baseline과 기간 snapshot의 stable dimension을 반환한다", async () => {
    const subject = createSubject({
      currentAssets: [
        {
          assetId: "deleted-stock",
          type: "stock",
          ownerRefKey,
          lifecycle: "deleted",
        },
      ],
      ownerProfiles: [{ ownerRefKey, lifecycle: "archived" }],
      source: {
        kind: "ready",
        baseline: point("2026-06-30", 100_000),
        window: [point("2026-07-01", 100_000), point("2026-07-02", 0)],
        sourceCheckpoint: "asset-history-42",
      },
    });

    const result = await subject.queryHistory({
      householdId: "house-1",
      period,
    });

    expect(result).toEqual({
      kind: "success",
      value: {
        schemaVersion: 1,
        points: [
          point("2026-06-30", 100_000),
          point("2026-07-01", 100_000),
          point("2026-07-02", 0),
        ],
        dimensions: {
          typeKeys: ["stock"],
          ownerRefKeys: [ownerRefKey],
        },
        sourceCheckpoint: "asset-history-42",
        updatedAt: "2026-07-20T00:00:00.000Z",
        freshness: "fresh",
      },
    });
  });

  it("[T-AST-006][AST-004/DEC-058] 명시적 0원 dimension은 데이터 없음으로 제거하지 않는다", async () => {
    const result = await createSubject({
      currentAssets: [],
      ownerProfiles: [],
      source: {
        kind: "ready",
        baseline: point("2026-06-30", 0),
        window: [],
        sourceCheckpoint: "explicit-zero",
      },
    }).queryHistory({ householdId: "house-1", period });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        dimensions: {
          typeKeys: ["stock"],
          ownerRefKeys: [ownerRefKey],
        },
        points: [point("2026-06-30", 0)],
      }),
    });
  });

  it("[T-AST-006][AST-004/DEC-058] dimension과 point 순서는 원천 조회 순서와 무관하게 결정적이다", async () => {
    const householdOwner = "household" as const;
    const result = await createSubject({
      currentAssets: [],
      ownerProfiles: [],
      source: {
        kind: "ready",
        window: [
          {
            ...point("2026-07-02", 20, ownerRefKey),
            byType: { stock: 20, deposit: 0 },
            byOwnerRefKey: { [ownerRefKey]: 20, [householdOwner]: 0 },
          },
          point("2026-07-01", 10, householdOwner),
        ],
        sourceCheckpoint: "unordered",
      },
    }).queryHistory({ householdId: "house-1", period });

    expect(result).toMatchObject({
      kind: "success",
      value: {
        points: [
          expect.objectContaining({ localDate: "2026-07-01" }),
          expect.objectContaining({ localDate: "2026-07-02" }),
        ],
        dimensions: {
          typeKeys: ["deposit", "stock"],
          ownerRefKeys: ["household", ownerRefKey],
        },
      },
    });
  });

  it.each([
    [{ kind: "no-data" } as const, { kind: "no-data" } as const],
    [
      {
        kind: "retryable-failure",
        code: "ASSET_HISTORY_UNAVAILABLE",
      } as const,
      {
        kind: "retryable-failure",
        code: "ASSET_HISTORY_UNAVAILABLE",
      } as const,
    ],
  ])(
    "[T-AST-006][AST-004] Snapshot 부재와 저장소 실패를 서로 다른 typed result로 유지한다",
    async (source, expected) => {
      const result = await createSubject({
        currentAssets: [],
        ownerProfiles: [],
        source,
      }).queryHistory({ householdId: "house-1", period });

      expect(result).toEqual(expected);
    },
  );
});
