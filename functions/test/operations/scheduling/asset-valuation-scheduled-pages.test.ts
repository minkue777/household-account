import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import type { AssetSnapshotProjectionInputPort } from "../../../src/contexts/portfolio/core/application/ports/in/assetSnapshotProjectionInputPort";
import type { PortfolioCommandMetadata } from "../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import {
  createAssetValuationScheduledPages,
  type AssetValuationHouseholdPageReader,
  type AssetValuationRefreshWorkflow,
} from "../../../src/operations/scheduling/assetValuationScheduledPages";

function householdReader(): AssetValuationHouseholdPageReader {
  const households = [
    { householdId: "house-active", active: true },
    { householdId: "house-deleted", active: false },
  ];
  return {
    async next(after) {
      const index =
        after === undefined
          ? 0
          : households.findIndex(({ householdId }) => householdId === after) + 1;
      return index >= 0 && index < households.length
        ? households[index]
        : undefined;
    },
  };
}

describe("asset-valuation-daily scheduled pages", () => {
  it("refresh phase가 모두 terminal인 뒤에만 snapshot phase를 시작하고 마지막 성공 시세 유지도 완료 결과로 남깁니다", async () => {
    const order: string[] = [];
    const metadata: PortfolioCommandMetadata[] = [];
    const refresh: AssetValuationRefreshWorkflow = {
      async refreshMarketValues(input) {
        order.push(`refresh:${input.metadata.householdId}`);
        metadata.push(input.metadata);
        return {
          kind: "success",
          value: {
            refreshedCount: 1,
            targetCount: 2,
            retainedLastSuccessCount: 1,
          },
        };
      },
    };
    const snapshots: AssetSnapshotProjectionInputPort = {
      async project(input) {
        order.push(`snapshot:${input.householdId}`);
        return {
          kind: "projected",
          snapshot: {
            schemaVersion: 1,
            householdId: input.householdId,
            localDate: input.localDate,
            total: 100,
            financial: 100,
            byType: {
              savings: 0,
              stock: 100,
              crypto: 0,
              property: 0,
              gold: 0,
              loan: 0,
            },
            byOwnerRefKey: { household: 100 },
            ownerDisplayNames: { household: "가구" },
            sourceAssetVersions: { asset: 2 },
            sourceCheckpoint: input.sourceCheckpoint,
            calculatedAt: input.calculatedAt,
          },
        };
      },
    };
    const pages = createAssetValuationScheduledPages(
      {
        database: {} as firestore.Firestore,
        executionKey: "asset-valuation-daily:2026-07-21",
        scheduledFor: "2026-07-21T14:55:00.000Z",
        asOfDate: "2026-07-21",
      },
      { households: householdReader(), refresh, snapshots },
    );

    const results = [];
    let checkpoint: string | undefined;
    for (let index = 0; index < 6; index += 1) {
      const page = await pages.nextPage(checkpoint);
      expect(page).toBeDefined();
      if (page === undefined) break;
      results.push(page);
      checkpoint = page.checkpointAfter;
    }

    expect(results).toHaveLength(6);
    expect(results[0].targets[0].outcome).toEqual({
      kind: "SKIPPED",
      receipt: "terminal-retained:1:refreshed:1:targets:2",
    });
    expect(results[1].targets[0].outcome).toEqual({
      kind: "SKIPPED",
      receipt: "HOUSEHOLD_NOT_ACTIVE",
    });
    expect(results[2].checkpointAfter).toBe("asset-valuation:snapshot");
    expect(results[5]).toMatchObject({
      checkpointAfter: "asset-valuation:complete",
      terminal: true,
    });
    expect(order).toEqual([
      "refresh:house-active",
      "snapshot:house-active",
    ]);
    expect(metadata[0]).toMatchObject({
      householdId: "house-active",
      principalUid: "system:asset-valuation-daily",
      commandName: "portfolio.refresh-market-values.v1",
      occurredAt: "2026-07-21T14:55:00.000Z",
    });
    expect(await pages.nextPage("asset-valuation:complete")).toBeUndefined();
  });

  it("알 수 없는 checkpoint는 외부 호출 없이 거부합니다", async () => {
    const pages = createAssetValuationScheduledPages(
      {
        database: {} as firestore.Firestore,
        executionKey: "asset-valuation-daily:2026-07-21",
        scheduledFor: "2026-07-21T14:55:00.000Z",
        asOfDate: "2026-07-21",
      },
      {
        households: householdReader(),
        refresh: {
          async refreshMarketValues() {
            throw new Error("must not run");
          },
        },
        snapshots: {
          async project() {
            throw new Error("must not run");
          },
        },
      },
    );

    await expect(pages.nextPage("unknown")).rejects.toThrow(
      "ASSET_VALUATION_CHECKPOINT_INVALID",
    );
  });
});
