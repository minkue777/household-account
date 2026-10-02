import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { collectPortfolioPositionRuntimeMigration } from "../../../src/adapters/firebase/migration/collectors/portfolioPositionRuntimeMigrationCollector";
import { RUNTIME_MIGRATION_KIND, RUNTIME_MIGRATION_SCHEMA_SCOPE } from "../../../src/operations/migration/public";

describe("T-HOLD-001 HOLD-004 이관 최초 수량 이력", () => {
  it("Position과 최초 관측 history를 함께 계획하고 금액을 중복 합산하지 않는다", async () => {
    const snapshot = { id: "holding", ref: { path: "stock_holdings/holding", parent: { id: "stock_holdings" } }, data: () => ({ householdId: "house", assetId: "pension", market: "KRX", stockCode: "368590", stockName: "RISE 미국나스닥100", quantity: 855, avgPrice: 20000, schemaVersion: 1, createdAt: "2025-01-01T00:00:00Z" }) } as unknown as QueryDocumentSnapshot;
    const input = { scope: { householdId: "house", projectId: "demo-test", migrationId: "migration", operatorId: "operator", migrationKind: RUNTIME_MIGRATION_KIND, schemaScope: RUNTIME_MIGRATION_SCHEMA_SCOPE }, mappings: { version: 1 as const, householdIdHash: "hash" }, plannedAt: "2026-07-21T15:01:00.000Z", householdPath: "households/house", legacyAssets: [], legacyStocks: [snapshot], legacyCrypto: [], canonicalAssets: new Map([["pension", {}]]), loadExistingPosition: async () => undefined };
    const result = await collectPortfolioPositionRuntimeMigration(input);
    expect(result.unresolved).toEqual([]);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.reduce((sum, draft) => sum + draft.amountInWon, 0)).toBe(17100000);
    const history = result.drafts.find(draft => draft.targetPath.includes("/positionHistory/"));
    expect(history).toMatchObject({ logicalCollection: "position-history", amountInWon: 0, targetData: { householdId: "house", assetId: "pension", positionId: "holding", quantity: 855, snapshotDate: "2026-07-22", observedAt: input.plannedAt, sourceVersion: 1, operation: "added" } });
    expect(history?.sourceFingerprint).toBe(result.drafts[0]?.sourceFingerprint);
    expect(await collectPortfolioPositionRuntimeMigration(input)).toEqual(result);
    expect((await collectPortfolioPositionRuntimeMigration({ ...input, loadExistingPosition: async () => ({ quantity: 999 }) })).drafts).toEqual([]);
  });
});
