import { describe, expect, it, vi } from "vitest";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FirebasePortfolioRuntimeStateLoader } from "../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeStateLoader";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { for (let turn = 0; turn < 20; turn += 1) await Promise.resolve(); }

function fixture() {
  const memory = new InMemoryFirestore();
  memory.seed("households/house-1/assets/asset-1", { householdId: "house-1", type: "stock", name: "Canonical", ownerRef: { kind: "profile", profileId: "owner-1" }, lifecycleState: "active", aggregateVersion: 2 });
  memory.seed("assets/asset-1", { householdId: "house-1", type: "stock", name: "Legacy", owner: "Owner", currentBalance: 100 });
  memory.seed("households/house-1/assetOwnerProfiles/owner-1", { displayName: "Owner", lifecycleState: "active" });
  memory.seed("stock_holdings/position-1", { householdId: "house-1", assetId: "asset-1", holdingType: "stock", market: "KRX", stockCode: "005930", stockName: "Stock", quantity: 2, avgPrice: 100 });
  memory.seed("households/house-1/assets/asset-1/positions/position-1", { householdId: "house-1", assetId: "asset-1", positionKind: "stock", instrumentType: "stock", market: "KRX", instrumentCode: "005930", quantity: 3, averagePriceInWon: 100, priceScale: 1, lifecycleState: "active", aggregateVersion: 2 });
  memory.seed("stock_holdings/foreign", { householdId: "house-2", assetId: "foreign", stockCode: "FOREIGN", quantity: 10 });
  return memory;
}

describe("portfolio state read dependency branches", () => {
  it("starts legacy queries before assets resolve and canonical positions before slow legacy queries finish", async () => {
    const memory = fixture();
    const assetsReady = deferred();
    const legacyReady = deferred();
    await memory.runTransaction(async transaction => {
      type ReadTarget = Parameters<typeof transaction.get>[0];
      const pathOf = (reference: ReadTarget) => "path" in reference ? reference.path : reference.collectionPath;
      const get = vi.fn(async (reference: ReadTarget) => {
        const path = pathOf(reference);
        if (path === "households/house-1/assets") await assetsReady.promise;
        if (path === "stock_holdings" || path === "crypto_holdings") await legacyReady.promise;
        return transaction.get(reference);
      });
      const loader = new FirebasePortfolioRuntimeStateLoader(memory as unknown as Firestore);
      let completed = false;
      const loaded = loader.load({ get } as unknown as Transaction, "house-1", { automationPlans: false }).then(value => { completed = true; return value; });
      const paths = () => get.mock.calls.map(([reference]) => pathOf(reference));
      expect(paths()).toEqual(expect.arrayContaining(["households/house-1/assets", "stock_holdings", "crypto_holdings"]));
      assetsReady.resolve();
      await settle();
      expect(paths()).toContain("households/house-1/assets/asset-1/positions");
      expect(completed).toBe(false);
      legacyReady.resolve();
      const result = await loaded;
      expect(result.state.assets).toEqual([expect.objectContaining({ assetId: "asset-1", name: "Canonical", ownerRef: { kind: "profile", profileId: "owner-1" }, ownerDisplayName: "Owner", currentBalance: 100 })]);
      expect(result.state.positions).toEqual([expect.objectContaining({ positionId: "position-1", quantity: 3, aggregateVersion: 2 })]);
      expect(result.legacyStockPositionIds).toEqual(new Set(["position-1"]));
    });
  });

  it("batches the scoped canonical and legacy asset documents without including another household's legacy fields", async () => {
    const memory = fixture();
    memory.seed("assets/asset-1", { householdId: "house-2", type: "stock", currentBalance: 999999, memo: "foreign" });
    await memory.runTransaction(async transaction => {
      const get = vi.fn(transaction.get.bind(transaction));
      const getAll = transaction.getAll.bind(transaction);
      const batches: string[][] = [];
      transaction.getAll = async (...references) => {
        batches.push(references.map(reference => reference.path));
        return getAll(...references);
      };
      const result = await new FirebasePortfolioRuntimeStateLoader(memory as unknown as Firestore).load({ get, getAll: transaction.getAll } as unknown as Transaction, "house-1", { assetId: "asset-1", automationPlans: false });
      expect(batches).toEqual([["households/house-1/assets/asset-1", "assets/asset-1"]]);
      expect(get).toHaveBeenCalledTimes(4);
      expect(result.state.assets).toEqual([expect.objectContaining({ assetId: "asset-1", name: "Canonical", currentBalance: 0, memo: "" })]);
      expect(result.legacyAssetIds.size).toBe(0);
    });
  });

  it("does not add position or plan reads when the caller excludes them", async () => {
    const memory = fixture();
    const loader = new FirebasePortfolioRuntimeStateLoader(memory as unknown as Firestore);
    const result = await memory.runTransaction(transaction => loader.load(transaction as unknown as Transaction, "house-1", { positions: false, automationPlans: false }));
    expect(result.state.positions).toEqual([]);
    expect(result.state.automationPlans).toEqual([]);
    expect(memory.transactionReads().map(read => read.path)).toEqual(["households/house-1/assets", "assets", "households/house-1/assetOwnerProfiles"]);
  });
});
