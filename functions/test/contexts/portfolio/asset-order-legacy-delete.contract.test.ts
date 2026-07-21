import { describe, expect, it } from "vitest";
import type { OrderedAssetView } from "../../../src/contexts/portfolio/core/public";
import {
  createAssetOrderLegacyDeleteFixture,
  type AssetOrderLegacyDeleteFixtureSubject,
  type LegacyAssetState,
} from "../../support/asset-order-legacy-delete-fixture";

export interface AssetOrderLegacyDeleteSubject
  extends AssetOrderLegacyDeleteFixtureSubject {}

export function createSubject(seed: {
  state: LegacyAssetState;
  failLegacyDeleteAt?: "position" | "history";
}): AssetOrderLegacyDeleteSubject {
  return createAssetOrderLegacyDeleteFixture(seed);
}

const initial: LegacyAssetState = {
  assets: [
    { assetId: "asset-a", order: 0, aggregateVersion: 1 },
    { assetId: "asset-b", order: 1, aggregateVersion: 3 },
  ],
  positionIds: ["asset-a:position-1"],
  historyIds: ["asset-a:history-1"],
};

describe("Portfolio 순서와 legacy 물리 삭제 특성화 계약", () => {
  it.each([
    [["asset-a", "asset-a"], "중복"],
    [["asset-a"], "누락"],
    [["asset-a", "asset-b", "asset-c"], "타 가구·미지 asset"],
  ] as const)(
    "[T-AST-008][AST-003] 순서 집합의 %s은 전체 상태를 유지하는 ValidationError다",
    async (orderedAssetIds, _label) => {
      const subject = createSubject({ state: initial });

      expect(
        await subject.reorder({
          orderedAssetIds,
          expectedVersions: { "asset-a": 1, "asset-b": 3 },
        }),
      ).toEqual({ kind: "validation-error", code: "INVALID_ORDER_SET" });
      expect(subject.currentState()).toEqual(initial);
      expect(subject.recordedValuationEvents()).toEqual([]);
    },
  );

  it("[T-AST-008][AST-003] 유효한 재정렬은 전체 순서와 version을 한 결과로 변경하며 valuation Event를 만들지 않는다", async () => {
    const subject = createSubject({ state: initial });

    const result = await subject.reorder({
      orderedAssetIds: ["asset-b", "asset-a"],
      expectedVersions: { "asset-a": 1, "asset-b": 3 },
    });

    expect(result).toEqual({
      kind: "success",
      assets: [
        { assetId: "asset-b", order: 0, aggregateVersion: 4 },
        { assetId: "asset-a", order: 1, aggregateVersion: 2 },
      ],
    });
    expect(subject.currentState().assets).toEqual(
      result.kind === "success" ? result.assets : [],
    );
    expect(subject.recordedValuationEvents()).toEqual([]);
  });

  it("[T-AST-008][AST-003] 하나라도 stale expectedVersion이면 순서 전체를 유지하는 Conflict다", async () => {
    const subject = createSubject({ state: initial });

    expect(
      await subject.reorder({
        orderedAssetIds: ["asset-b", "asset-a"],
        expectedVersions: { "asset-a": 1, "asset-b": 2 },
      }),
    ).toEqual({ kind: "conflict", code: "ASSET_ORDER_VERSION_MISMATCH" });
    expect(subject.currentState()).toEqual(initial);
    expect(subject.recordedValuationEvents()).toEqual([]);
  });

  it("[T-AST-008][AST-006] 목표 Delete Writer는 자산을 deleted로만 전이하고 종속 물리 삭제를 호출하지 않는다", async () => {
    const subject = createSubject({ state: initial });

    expect(
      await subject.logicalDelete({
        assetId: "asset-a",
        expectedVersion: 1,
        commandId: "delete-asset-a",
        idempotencyKey: "delete-asset-a",
      }),
    ).toEqual({
      kind: "success",
      asset: {
        assetId: "asset-a",
        lifecycle: "deleted",
        aggregateVersion: 2,
      },
    });
    expect(subject.logicallyDeletedAsset("asset-a")).toEqual({
      assetId: "asset-a",
      lifecycle: "deleted",
      aggregateVersion: 2,
    });
    expect(subject.currentState().positionIds).toEqual(["asset-a:position-1"]);
    expect(subject.currentState().historyIds).toEqual(["asset-a:history-1"]);
    expect(subject.physicalDeleteAttempts()).toBe(0);
  });

  it("[T-AST-008][AST-003/AST-006] legacy 물리 삭제의 종속 삭제 실패는 부분 상태를 남길 수 있음을 특성화한다", async () => {
    const subject = createSubject({
      state: initial,
      failLegacyDeleteAt: "position",
    });

    expect(await subject.legacyDelete("asset-a")).toEqual({
      kind: "partial-failure",
      code: "LEGACY_DEPENDENT_DELETE_FAILED",
      failedDataKind: "position",
    });
    expect(subject.currentState()).toEqual({
      assets: [{ assetId: "asset-b", order: 1, aggregateVersion: 3 }],
      positionIds: ["asset-a:position-1"],
      historyIds: ["asset-a:history-1"],
    });
  });

  it("[T-AST-008][AST-003] 순서가 실제로 바뀌지 않은 자산은 version을 불필요하게 증가시키지 않는다", async () => {
    const subject = createSubject({ state: initial });
    const result = await subject.reorder({
      orderedAssetIds: ["asset-a", "asset-b"],
      expectedVersions: { "asset-a": 1, "asset-b": 3 },
    });

    expect(result).toEqual({
      kind: "success",
      assets: initial.assets as readonly OrderedAssetView[],
    });
  });
});
