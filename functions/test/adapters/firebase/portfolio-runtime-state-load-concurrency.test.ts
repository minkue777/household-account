import { describe, expect, it, vi } from "vitest";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FirebasePortfolioRuntimeStateLoader } from "../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeStateLoader";
import { InMemoryFirestore } from "../../support/in-memory-firestore";
import { FirebaseAssetSnapshotProjectionSource } from "../../../src/adapters/firebase/portfolio/firebaseAssetSnapshotProjection";
import { FirebasePortfolioRuntimeStore } from "../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeStore";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const memory = new InMemoryFirestore();
  memory.seed("households/house-1/assets/asset-1", { householdId: "house-1", type: "stock", name: "Canonical", currentBalance: 100, ownerRef: { kind: "profile", profileId: "owner-1" }, lifecycleState: "active", aggregateVersion: 2 });
  memory.seed("assets/asset-1", { householdId: "house-1", type: "stock", name: "Legacy", owner: "Owner", currentBalance: 100 });
  memory.seed("households/house-1/assetOwnerProfiles/owner-1", { displayName: "Owner", lifecycleState: "active" });
  memory.seed("stock_holdings/position-1", { householdId: "house-1", assetId: "asset-1", holdingType: "stock", market: "KRX", stockCode: "005930", stockName: "Stock", quantity: 2, avgPrice: 100 });
  memory.seed("households/house-1/assets/asset-1/positions/position-1", { householdId: "house-1", assetId: "asset-1", positionKind: "stock", instrumentType: "stock", market: "KRX", instrumentCode: "005930", instrumentName: "Stock", quantity: 3, averagePriceInWon: 100, priceScale: 1, lifecycleState: "active", aggregateVersion: 2 });
  memory.seed("stock_holdings/foreign", { householdId: "house-2", assetId: "foreign", stockCode: "FOREIGN", quantity: 10 });
  return memory;
}

describe("portfolio state read dependency branches", () => {
  it("스냅샷 조회는 포지션·자동화 계획을 제외해도 자산 평가액과 소유자 표시명을 보존한다", async () => {
    const store = new FirebasePortfolioRuntimeStore(fixture() as unknown as Firestore);
    const read = vi.spyOn(store, "readState");
    const result = await new FirebaseAssetSnapshotProjectionSource(store).readCurrent("house-1");
    expect(read).toHaveBeenCalledWith("house-1", { positions: false, automationPlans: false });
    expect(result.assets).toEqual([expect.objectContaining({ assetId: "asset-1", currentBalance: 100 })]);
    expect(result.ownerDisplayNames).toEqual({ "profile:owner-1": "Owner" });
  });

  it("starts household positions with assets and profiles without waiting for the asset list", async () => {
    const memory = fixture();
    const assetsReady = deferred();
    await memory.runTransaction(async transaction => {
      type ReadTarget = Parameters<typeof transaction.get>[0];
      const pathOf = (reference: ReadTarget) => "path" in reference ? reference.path : reference.collectionPath;
      const get = vi.fn(async (reference: ReadTarget) => {
        const path = pathOf(reference);
        if (path === "households/house-1/assets") await assetsReady.promise;
        return transaction.get(reference);
      });
      const loader = new FirebasePortfolioRuntimeStateLoader(memory as unknown as Firestore);
      const loaded = loader.load({ get } as unknown as Transaction, "house-1", { automationPlans: false });
      const paths = () => get.mock.calls.map(([reference]) => pathOf(reference));
      expect(paths()).toEqual(["households/house-1/assets", "households/house-1/assetOwnerProfiles", "positions"]);
      assetsReady.resolve();
      const result = await loaded;
      expect(result.state.assets).toEqual([expect.objectContaining({ assetId: "asset-1", name: "Canonical", currentBalance: 100, ownerRef: { kind: "profile", profileId: "owner-1" }, ownerDisplayName: "Owner" })]);
      expect(result.state.positions).toEqual([expect.objectContaining({ positionId: "position-1", quantity: 3, aggregateVersion: 2 })]);
      expect(result.canonicalPositionIds).toEqual(new Set(["position-1"]));
      expect(paths()).not.toEqual(expect.arrayContaining(["assets", "stock_holdings", "crypto_holdings"]));
    });
  });

  it("uses three queries for nineteen assets while retaining canonical positions and excluding forged or orphan parents", async () => {
    const memory = fixture();
    for (let index = 2; index <= 19; index += 1) {
      memory.seed(`households/house-1/assets/asset-${index}`, { householdId: "house-1", type: "savings", name: `Account ${index}`, currentBalance: index });
    }
    const position = memory.document("households/house-1/assets/asset-1/positions/position-1")!;
    memory.seed("households/house-1/assets/asset-2/positions/manual", { ...position, assetId: "asset-2", instrumentType: "manual", market: "UNRESOLVED" });
    for (const path of [
      "households/house-2/assets/asset-1/positions/foreign",
      "households/house-1/assets/missing/positions/orphan",
      "households/house-1/assets/asset-1/archive/old/positions/nested",
    ]) memory.seed(path, position);
    const result = await memory.runTransaction(transaction => new FirebasePortfolioRuntimeStateLoader(memory as unknown as Firestore)
      .load(transaction as unknown as Transaction, "house-1", { automationPlans: false }));
    expect(memory.transactionReads().map(read => read.path)).toEqual(["households/house-1/assets", "households/house-1/assetOwnerProfiles", "positions"]);
    expect(result.state.assets).toHaveLength(19);
    expect(result.state.positions).toEqual([
      expect.objectContaining({ positionId: "position-1", assetId: "asset-1", quantity: 3 }),
      expect.objectContaining({ positionId: "manual", assetId: "asset-2", instrumentType: "manual", quantity: 3 }),
    ]);
    expect(result.canonicalPositionIds).toEqual(new Set(["position-1", "manual"]));
  });

  it("propagates a failed position query instead of returning an empty portfolio", async () => {
    const memory = fixture();
    await memory.runTransaction(async transaction => {
      const get = async (reference: Parameters<typeof transaction.get>[0]) => {
        if ("collectionPath" in reference && reference.collectionPath === "positions") throw new Error("POSITION_READ_FAILED");
        return transaction.get(reference);
      };
      await expect(new FirebasePortfolioRuntimeStateLoader(memory as unknown as Firestore)
        .load({ get } as unknown as Transaction, "house-1", { automationPlans: false })).rejects.toThrow("POSITION_READ_FAILED");
    });
  });

  it("reads a scoped canonical asset without touching stale or foreign legacy documents", async () => {
    const memory = fixture();
    memory.seed("assets/asset-1", { householdId: "house-2", type: "stock", currentBalance: 999999, memo: "foreign" });
    const result = await memory.runTransaction(transaction => new FirebasePortfolioRuntimeStateLoader(memory as unknown as Firestore)
      .load(transaction as unknown as Transaction, "house-1", { assetId: "asset-1", automationPlans: false }));
    expect(memory.transactionReads().map(read => read.path)).toEqual([
      "households/house-1/assets/asset-1", "households/house-1/assetOwnerProfiles", "households/house-1/assets/asset-1/positions",
    ]);
    expect(result.state.assets).toEqual([expect.objectContaining({ assetId: "asset-1", name: "Canonical", currentBalance: 100, memo: "" })]);
  });

  it("does not add position or plan reads when the caller excludes them", async () => {
    const memory = fixture();
    const loader = new FirebasePortfolioRuntimeStateLoader(memory as unknown as Firestore);
    const result = await memory.runTransaction(transaction => loader.load(transaction as unknown as Transaction, "house-1", { positions: false, automationPlans: false }));
    expect(result.state.positions).toEqual([]);
    expect(result.state.automationPlans).toEqual([]);
    expect(memory.transactionReads().map(read => read.path)).toEqual(["households/house-1/assets", "households/house-1/assetOwnerProfiles"]);
  });
});
