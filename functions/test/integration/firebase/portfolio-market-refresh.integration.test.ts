import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FirebasePortfolioRuntimeStore } from "../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeStore";
import { FirebasePortfolioProviderHealthStore } from "../../../src/adapters/firebase/portfolio/firebasePortfolioProviderHealthStore";
import { createPortfolioRuntimeApplication } from "../../../src/contexts/portfolio/core/application/portfolioRuntimeApplication";
import type { PortfolioCommandMetadata, PortfolioMarketQuotePort } from "../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";

const projectId = "demo-portfolio-market-refresh";
const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const accountPath = "households/house/assets/account";
const occurredAt = "2026-10-29T07:00:00.000Z";
const quote = { kind: "success", quote: { priceInWon: 500, provider: "naver-domestic", observedAt: occurredAt } } as const;
let app: App;
let db: Firestore;

function metadata(commandId: string, principalUid = "uid"): PortfolioCommandMetadata {
  return { householdId: "house", principalUid, actorMemberId: principalUid, commandId, idempotencyKey: commandId,
    commandName: "portfolio.refresh-market-values.v1", payloadFingerprint: commandId, occurredAt };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function seedAccount() {
  const batch = db.batch();
  batch.set(db.doc(accountPath), { householdId: "house", type: "stock", name: "주식 계좌", currency: "KRW",
    ownerRef: { kind: "profile", profileId: "owner" }, currentBalance: 360, costBasis: 360, memo: "보존할 메모", lifecycleState: "active", aggregateVersion: 1 });
  batch.set(db.doc("households/house/assetOwnerProfiles/owner"), { displayName: "명의자", lifecycleState: "active" });
  for (const [id, instrumentType, quantity, price, market] of [
    ["stock", "stock", 2, 100, "KRX"], ["cash", "cash", 1, 100, "UNRESOLVED"], ["manual", "manual", 3, 20, "UNRESOLVED"],
  ] as const) {
    batch.set(db.doc(`${accountPath}/positions/${id}`), { householdId: "house", assetId: "account", positionKind: "stock",
      instrumentType, holdingType: instrumentType, instrumentCode: id === "stock" ? "005930" : `MANUAL:${id}`,
      instrumentName: id, market, quantity, averagePriceInWon: price, priceScale: 1,
      lastQuote: { priceInWon: price, provider: "client-observed", observedAt: occurredAt }, lifecycleState: "active", aggregateVersion: 1 });
  }
  for (const [id, type, lifecycleState, currentBalance] of [
    ["savings", "savings", "active", 12345], ["deleted", "stock", "deleted", 67890], ["purging", "crypto", "purging", 23456],
  ] as const) {
    batch.set(db.doc(`households/house/assets/${id}`), { householdId: "house", type, name: id, currency: "KRW",
      ownerRef: { kind: "household" }, lifecycleState, currentBalance, memo: "갱신 대상 아님", aggregateVersion: 1 });
  }
  await batch.commit();
}

suite("자산 시세 갱신의 실제 Firestore 저장 경계", () => {
  beforeAll(() => { app = initializeApp({ projectId }, projectId); db = getFirestore(app); });
  beforeEach(async () => {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
    if (!response.ok) throw new Error("EMULATOR_RESET_FAILED");
    await seedAccount();
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  it("[HOLD-003][HOLD-004][JOB-AST-001] 주식 시세와 같은 계좌의 현금·수동 평가액을 함께 보존하고 비대상 자산은 변경하지 않는다", async () => {
    const getQuote = vi.fn<PortfolioMarketQuotePort["getQuote"]>(async () => quote);
    const runtime = createPortfolioRuntimeApplication({ store: new FirebasePortfolioRuntimeStore(db), marketQuotes: { getQuote } });
    const untouchedPaths = ["savings", "deleted", "purging"].map(id => `households/house/assets/${id}`)
      .concat([`${accountPath}/positions/cash`, `${accountPath}/positions/manual`]);
    const before = await db.getAll(...untouchedPaths.map(path => db.doc(path)));
    const request = { metadata: metadata("mixed"), assetClass: "all" as const };
    const result = await runtime.refreshMarketValues(request);
    expect(result).toMatchObject({ kind: "success", value: { refreshedCount: 1, targetCount: 1, failedCount: 0 } });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect((await db.doc(accountPath).get()).data()).toMatchObject({ currentBalance: 1160, costBasis: 360, aggregateVersion: 2,
      ownerRef: { kind: "profile", profileId: "owner" }, memo: "보존할 메모" });
    expect((await db.doc(`${accountPath}/positions/stock`).get()).data()).toMatchObject({ quantity: 2, aggregateVersion: 2, lastQuote: quote.quote });
    const after = await db.getAll(...untouchedPaths.map(path => db.doc(path)));
    expect(after.map(document => document.data())).toEqual(before.map(document => document.data()));
    expect(after.map(document => document.updateTime?.toMillis())).toEqual(before.map(document => document.updateTime?.toMillis()));
    expect((await db.collection(`${accountPath}/positionHistory`).get()).empty).toBe(true);
    const events = await db.collection("outboxEvents").get();
    expect(events.docs.map(document => document.data().eventType).sort()).toEqual(["AssetValuationChanged", "PositionChanged"]);
    expect(await runtime.refreshMarketValues(request)).toEqual(result);
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect((await db.collection("outboxEvents").get()).size).toBe(2);
  });

  it("[HOLD-004] 외부 시세 대기 중 수량을 수정하면 확정된 사용자 수정과 그 평가액을 보존하고 시세 저장을 거절한다", async () => {
    const quoteStarted = deferred();
    const finishQuote = deferred();
    const runtime = createPortfolioRuntimeApplication({ store: new FirebasePortfolioRuntimeStore(db), marketQuotes: {
      async getQuote() { quoteStarted.resolve(); await finishQuote.promise; return quote; },
    } });
    const pending = runtime.refreshMarketValues({ metadata: metadata("conflict"), assetClass: "all" });
    let edited;
    let eventsAfterEdit;
    try {
      await quoteStarted.promise;
      edited = await runtime.updatePosition({ metadata: { ...metadata("edit"), commandName: "portfolio.update-position.v1" },
        assetId: "account", positionId: "stock", positionKind: "stock", expectedAssetVersion: 1, expectedVersion: 1, changes: { quantity: 3 } });
      expect(edited.kind).toBe("success");
      eventsAfterEdit = (await db.collection("outboxEvents").get()).size;
    } finally { finishQuote.resolve(); await pending; }
    await expect(pending).resolves.toEqual({ kind: "error", code: "VALUATION_VERSION_MISMATCH", retryable: true });
    expect((await db.doc(accountPath).get()).data()).toMatchObject({ currentBalance: 460, costBasis: 460, aggregateVersion: 2 });
    expect((await db.doc(`${accountPath}/positions/stock`).get()).data()).toMatchObject({ quantity: 3, aggregateVersion: 2,
      lastQuote: { priceInWon: 100, provider: "client-observed" } });
    expect((await db.collection("outboxEvents").get()).size).toBe(eventsAfterEdit);
  }, 20_000);

  it("[HOLD-003][JOB-AST-001] 유형 변경 뒤 남은 보유종목을 보존하며 다른 가구·잘못된 부모 경로의 문서는 합산하지 않는다", async () => {
    const getQuote = vi.fn<PortfolioMarketQuotePort["getQuote"]>(async () => quote);
    const runtime = createPortfolioRuntimeApplication({ store: new FirebasePortfolioRuntimeStore(db), marketQuotes: { getQuote } });
    await expect(runtime.updateAsset({ metadata: { ...metadata("change-type"), commandName: "portfolio.update-asset.v1" },
      assetId: "account", expectedVersion: 1, changes: { type: "savings", subType: "deposit" } })).resolves.toMatchObject({ kind: "success" });
    const otherPaths = [
      "households/foreign/assets/account/positions/foreign",
      "households/house/other/document/positions/unrelated",
      "households/house/assets/missing/positions/orphan",
      `${accountPath}/archive/old/positions/nested`,
    ];
    const sample = (await db.doc(`${accountPath}/positions/stock`).get()).data()!;
    const batch = db.batch();
    for (const path of otherPaths) batch.set(db.doc(path), { ...sample, householdId: "house", assetId: "account", quantity: 999 });
    await batch.commit();
    const before = await db.getAll(...otherPaths.map(path => db.doc(path)));
    await expect(runtime.refreshMarketValues({ metadata: metadata("type-preserved"), assetClass: "all" }))
      .resolves.toMatchObject({ kind: "success", value: { refreshedCount: 1, targetCount: 1, failedCount: 0 } });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect((await db.doc(accountPath).get()).data()).toMatchObject({ type: "savings", subType: "deposit", currentBalance: 1160,
      costBasis: 360, aggregateVersion: 3, ownerRef: { kind: "profile", profileId: "owner" } });
    expect((await db.getAll(...otherPaths.map(path => db.doc(path)))).map(document => document.data()))
      .toEqual(before.map(document => document.data()));
  });

  it("[JOB-AST-001][HOLD-004] 공급자 상태 기록이 기다리는 동안 실제 자산 저장은 끝나지만 두 작업 완료 전에는 갱신 잠금을 해제하지 않는다", async () => {
    const healthStarted = deferred();
    const finishHealth = deferred();
    const health = new FirebasePortfolioProviderHealthStore(db);
    const getQuote = vi.fn<PortfolioMarketQuotePort["getQuote"]>(async () => quote);
    const runtime = createPortfolioRuntimeApplication({ store: new FirebasePortfolioRuntimeStore(db), marketQuotes: { getQuote },
      providerHealth: { async recordRun(observation) { healthStarted.resolve(); await finishHealth.promise; await health.recordRun(observation); } } });
    let completed = false;
    const pending = runtime.refreshMarketValues({ metadata: metadata("parallel"), assetClass: "all" }).then(result => { completed = true; return result; });
    try {
      await healthStarted.promise;
      await expect.poll(async () => (await db.doc(accountPath).get()).data()?.currentBalance, { timeout: 10_000 }).toBe(1160);
      expect(completed).toBe(false);
      const locks = await db.collection("households/house/operationLocks").get();
      expect(locks.docs.filter(document => !document.id.includes("cooldown"))).toHaveLength(1);
      await expect(runtime.refreshMarketValues({ metadata: metadata("second", "other-member"), assetClass: "all" }))
        .resolves.toMatchObject({ kind: "success", value: { refreshedCount: 0, skippedReason: "MARKET_REFRESH_IN_PROGRESS" } });
      expect(getQuote).toHaveBeenCalledTimes(1);
    } finally { finishHealth.resolve(); await pending; }
    await expect(pending).resolves.toMatchObject({ kind: "success", value: { refreshedCount: 1, failedCount: 0 } });
    expect((await db.collection("operations/runtime/providerHealthReceipts").get()).size).toBe(1);
    expect((await db.collection("operations/runtime/providerHealth").get()).docs[0].data()).toMatchObject({ status: "healthy", lastResultKind: "SUCCESS" });
    const locks = await db.collection("households/house/operationLocks").get();
    expect(locks.docs.filter(document => !document.id.includes("cooldown"))).toHaveLength(0);
  }, 20_000);
});
