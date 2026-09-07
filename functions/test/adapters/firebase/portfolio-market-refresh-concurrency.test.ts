import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { FirebasePortfolioRuntimeStore } from "../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeStore";
import { createPortfolioRuntimeApplication } from "../../../src/contexts/portfolio/core/application/portfolioRuntimeApplication";
import type { PortfolioCommandMetadata, PortfolioMarketQuotePort } from "../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const metadata: PortfolioCommandMetadata = { householdId: "house-1", principalUid: "uid-1", actorMemberId: "member-1", commandId: "refresh-1", idempotencyKey: "refresh-1", commandName: "portfolio.refresh-market-values.v1", payloadFingerprint: "payload-1", occurredAt: "2026-09-07T00:00:00Z" };
const quote = { kind: "success", quote: { priceInWon: 1000, observedAt: metadata.occurredAt, provider: "test" } } as const;

function fixture(codes: readonly string[], gold = false) {
  const memory = new InMemoryFirestore();
  memory.seed("households/house-1/assets/stock", { householdId: "house-1", type: "stock", name: "Account", currency: "KRW", currentBalance: 0, aggregateVersion: 1, lifecycleState: "active" });
  codes.forEach((code, index) => memory.seed(`households/house-1/assets/stock/positions/position-${index}`, {
    householdId: "house-1", assetId: "stock", positionKind: "stock", instrumentType: "stock", market: "KRX", instrumentCode: code,
    instrumentName: code, quantity: 1, averagePriceInWon: 100, priceScale: 1, lifecycleState: "active", aggregateVersion: 1,
  }));
  if (gold) memory.seed("households/house-1/assets/gold", { householdId: "house-1", type: "gold", subType: "physical", name: "Gold", currency: "KRW", currentBalance: 100, quantity: 1, aggregateVersion: 1, lifecycleState: "active" });
  return memory;
}

function application(memory: InMemoryFirestore, marketQuotes: PortfolioMarketQuotePort) {
  return createPortfolioRuntimeApplication({ store: new FirebasePortfolioRuntimeStore(memory as unknown as Firestore), marketQuotes });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("market refresh distinct quote scheduling", () => {
  it.each([false, true])("keeps the lease until the actual commit settles and releases once (commit fails: %s)", async failCommit => {
    const memory = fixture(["A"]);
    const commitReady = deferred();
    const finishCommit = deferred();
    const runTransaction = memory.runTransaction.bind(memory);
    let paused = false;
    memory.runTransaction = async operation => runTransaction(async transaction => {
      const result = await operation(transaction);
      if (!paused && typeof result === "object" && result !== null && "kind" in result && result.kind === "committed") {
        paused = true;
        commitReady.resolve();
        await finishCommit.promise;
        if (failCommit) throw new Error("commit unavailable");
      }
      return result;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = new FirebasePortfolioRuntimeStore(memory as unknown as Firestore);
    const release = vi.spyOn(store, "releaseRefreshLease");
    const getQuote = vi.fn<PortfolioMarketQuotePort["getQuote"]>(async () => quote);
    const runtime = createPortfolioRuntimeApplication({ store, marketQuotes: { getQuote } });
    const first = runtime.refreshMarketValues({ metadata, assetClass: "all" });
    await commitReady.promise;
    const locks = () => memory.paths("households/house-1/operationLocks/").filter(path => !path.includes("cooldown"));
    try {
      expect(release).not.toHaveBeenCalled();
      expect(locks()).toHaveLength(1);
      expect(memory.document("households/house-1/assets/stock/positions/position-0")).not.toHaveProperty("lastQuote");
      await expect(application(memory, { getQuote }).refreshMarketValues({
        metadata: { ...metadata, principalUid: "uid-2", actorMemberId: "member-2", commandId: "refresh-2", idempotencyKey: "refresh-2", payloadFingerprint: "payload-2" },
        assetClass: "all",
      })).resolves.toMatchObject({ kind: "success", value: { skippedReason: "MARKET_REFRESH_IN_PROGRESS", refreshedCount: 0 } });
      expect(getQuote).toHaveBeenCalledTimes(1);
    } finally { finishCommit.resolve(); }
    const result = await first;
    expect(result).toMatchObject(failCommit ? { kind: "error", code: "PORTFOLIO_UOW_FAILED", retryable: true } : { kind: "success", value: { refreshedCount: 1 } });
    expect(release).toHaveBeenCalledTimes(1);
    expect(locks()).toHaveLength(0);
    expect(memory.document("households/house-1/assets/stock")).toMatchObject({ currentBalance: failCommit ? 0 : 1000 });
  });

  it("converts a rejected atomic operation to a retryable result and releases its lease exactly once", async () => {
    const memory = fixture(["A"]);
    const store = new FirebasePortfolioRuntimeStore(memory as unknown as Firestore);
    vi.spyOn(store, "transact").mockRejectedValueOnce(new Error("unexpected transaction rejection"));
    const release = vi.spyOn(store, "releaseRefreshLease");
    const runtime = createPortfolioRuntimeApplication({ store, marketQuotes: { async getQuote() { return quote; } } });
    await expect(runtime.refreshMarketValues({ metadata, assetClass: "all" })).resolves.toEqual({ kind: "error", code: "MARKET_REFRESH_FAILED", retryable: true });
    expect(release).toHaveBeenCalledTimes(1);
    expect(memory.paths("households/house-1/operationLocks/").filter(path => !path.includes("cooldown"))).toHaveLength(0);
    expect(memory.document("households/house-1/assets/stock")).toMatchObject({ currentBalance: 0 });
  });

  it("uses five slots for distinct quotes and updates all fourteen positions/assets in two provider rounds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(metadata.occurredAt));
    const memory = fixture(["A", "A", "A", "A", "B", "B", "C", "C", "D", "E", "F", "G", "H"], true);
    let active = 0;
    let maximum = 0;
    const getQuote = vi.fn<PortfolioMarketQuotePort["getQuote"]>(async () => {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 100));
      active -= 1;
      return quote;
    });
    const startedAt = Date.now();
    let completedAfter: number | undefined;
    const result = application(memory, { getQuote }).refreshMarketValues({ metadata, assetClass: "all" }).then(value => { completedAfter = Date.now() - startedAt; return value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(getQuote.mock.calls.map(([target]) => target.instrumentCode)).toEqual(["A", "B", "C", "D", "E"]);
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toEqual({ kind: "success", value: { refreshedCount: 14, targetCount: 14, retainedLastSuccessCount: 0, failedCount: 0 } });
    expect(completedAfter).toBe(200);
    expect(getQuote).toHaveBeenCalledTimes(9);
    expect(maximum).toBe(5);
    expect(memory.document("households/house-1/assets/stock")).toMatchObject({ currentBalance: 13000, aggregateVersion: 2 });
    expect(memory.document("households/house-1/assets/gold")).toMatchObject({ currentBalance: 1000, aggregateVersion: 2 });
    for (let index = 0; index < 13; index += 1) expect(memory.document(`households/house-1/assets/stock/positions/position-${index}`)).toMatchObject({ aggregateVersion: 2, lastQuote: quote.quote });
  });

  it("does not fetch the same instrument again when duplicate positions cross the fifty-item boundary", async () => {
    const memory = fixture(Array(51).fill("A"));
    const getQuote = vi.fn<PortfolioMarketQuotePort["getQuote"]>(async () => quote);
    await expect(application(memory, { getQuote }).refreshMarketValues({ metadata, assetClass: "all" })).resolves.toMatchObject({ kind: "success", value: { refreshedCount: 51, targetCount: 51, failedCount: 0 } });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(memory.document("households/house-1/assets/stock")).toMatchObject({ currentBalance: 51000 });
    expect(memory.paths("stock_holdings/")).toHaveLength(51);
  });

  it("keeps the market in the quote identity when two positions have the same instrument code", async () => {
    const memory = fixture(["SAME", "SAME"]);
    const path = "households/house-1/assets/stock/positions/position-1";
    memory.seed(path, { ...memory.document(path), market: "US" });
    const getQuote = vi.fn<PortfolioMarketQuotePort["getQuote"]>(async target => ({ ...quote, quote: { ...quote.quote, priceInWon: target.market === "US" ? 2000 : 1000 } }));
    await application(memory, { getQuote }).refreshMarketValues({ metadata, assetClass: "all" });
    expect(getQuote).toHaveBeenCalledTimes(2);
    expect(memory.document("households/house-1/assets/stock")).toMatchObject({ currentBalance: 3000 });
  });

  it("shares the three-attempt retry budget and resumes only failed positions from a partial receipt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(metadata.occurredAt));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const memory = fixture(["A", "A", "A", "B", "B"]);
    let failed = true;
    const getQuote = vi.fn<PortfolioMarketQuotePort["getQuote"]>(async target => failed && target.instrumentCode === "A" ? { kind: "failure", code: "TIMEOUT", retryable: true } : quote);
    const runtime = application(memory, { getQuote });
    const first = runtime.refreshMarketValues({ metadata, assetClass: "all" });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(first).resolves.toMatchObject({ kind: "success", value: { refreshedCount: 2, failedCount: 3, completedTargetKeys: ["position:position-3", "position:position-4"], failedTargets: expect.arrayContaining([expect.objectContaining({ positionId: "position-0" })]) } });
    expect(getQuote.mock.calls.filter(([target]) => target.instrumentCode === "A")).toHaveLength(3);
    expect(getQuote.mock.calls.filter(([target]) => target.instrumentCode === "B")).toHaveLength(1);
    failed = false;
    await expect(runtime.refreshMarketValues({ metadata, assetClass: "all" })).resolves.toMatchObject({ kind: "success", value: { refreshedCount: 3, targetCount: 5, failedCount: 0 } });
    expect(getQuote.mock.calls.filter(([target]) => target.instrumentCode === "A")).toHaveLength(4);
    expect(getQuote.mock.calls.filter(([target]) => target.instrumentCode === "B")).toHaveLength(1);
    expect(memory.document("households/house-1/assets/stock")).toMatchObject({ currentBalance: 5000 });
    await runtime.refreshMarketValues({ metadata, assetClass: "all" });
    expect(getQuote).toHaveBeenCalledTimes(5);
  });
});
