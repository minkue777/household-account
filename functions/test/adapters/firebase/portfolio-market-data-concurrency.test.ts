import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { FirebasePortfolioMarketData } from "../../../src/adapters/firebase/portfolio/firebasePortfolioMarketData";
import { FirebasePortfolioQuoteObservations } from "../../../src/adapters/firebase/portfolio/firebasePortfolioQuoteObservations";
import type { PortfolioMarketTarget } from "../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import type { SafeExternalTextHttpInputPort, SafeExternalTextHttpResult } from "../../../src/platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function target(symbol: string, market: "US" | "KRX" = "US"): PortfolioMarketTarget {
  return { targetKey: `${market}:${symbol}`, assetId: "asset-1", kind: "stock", market, instrumentCode: symbol, quantity: 1, priceScale: 1 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function response(body: unknown): SafeExternalTextHttpResult {
  const text = JSON.stringify(body);
  return { kind: "success", body: text, finalUrl: "https://provider.example/quote", responseBytes: text.length, attempts: 1 };
}

const price = response({ data: { primaryData: { lastSalePrice: "$100" } } });
const rate = response({ base: "USD", quote: "KRW", rate: 1400, date: "2026-09-05" });
const unavailable: SafeExternalTextHttpResult = { kind: "retryable-failure", code: "PROVIDER_UNAVAILABLE", attempts: 1 };
const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function settle() { for (let turn = 0; turn < 30; turn += 1) await Promise.resolve(); }
function observations() { return new FirebasePortfolioQuoteObservations(new InMemoryFirestore() as unknown as Firestore); }

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("portfolio price and FX concurrency", () => {
  it("overlaps independent price and FX HTTP while selecting durable FX after the price is ready", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const store = observations();
    const saveSource = store.saveSource.bind(store);
    const saveRate = store.saveRate.bind(store);
    vi.spyOn(store, "saveSource").mockImplementation(async (...args) => { await sleep(20); return saveSource(...args); });
    vi.spyOn(store, "saveRate").mockImplementation(async (...args) => { await sleep(30); return saveRate(...args); });
    const execute = vi.fn<SafeExternalTextHttpInputPort["execute"]>(async request => {
      await sleep(request.provider === "nasdaq-us" ? 120 : 80);
      return request.provider === "nasdaq-us" ? price : rate;
    });
    const startedAt = Date.now();
    let completedAfter: number | undefined;
    const result = new FirebasePortfolioMarketData({ execute }, store).getQuote(target("AAPL")).then(value => {
      completedAfter = Date.now() - startedAt;
      return value;
    });
    expect(execute.mock.calls.map(([request]) => request.provider)).toEqual(["nasdaq-us", "frankfurter-v2"]);
    await vi.advanceTimersByTimeAsync(140);
    expect(store.saveRate).toHaveBeenCalledTimes(1);
    expect(completedAfter).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30);
    await expect(result).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 140000, sourcePrice: 100, exchangeRateDate: "2026-09-05", quoteObservedAt: "2026-09-06T00:00:00.120Z", exchangeRateObservedAt: "2026-09-06T00:00:00.080Z" } });
    // The same sequential I/O takes 120 + 20 + 80 + 30 = 250 ms.
    expect(completedAfter).toBe(170);
  });

  it("shares one FX request and transaction across five USD quotes without exceeding five HTTP slots", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const pricesReady = deferred<void>();
    const rateReady = deferred<void>();
    const saveReady = deferred<void>();
    const store = observations();
    const saveRate = store.saveRate.bind(store);
    vi.spyOn(store, "saveRate").mockImplementation(async value => { await saveReady.promise; return saveRate(value); });
    let active = 0;
    let maximum = 0;
    const execute = vi.fn<SafeExternalTextHttpInputPort["execute"]>(async request => {
      active += 1;
      maximum = Math.max(maximum, active);
      try {
        await (request.provider === "frankfurter-v2" ? rateReady.promise : pricesReady.promise);
        return request.provider === "frankfurter-v2" ? rate : price;
      } finally { active -= 1; }
    });
    const adapter = new FirebasePortfolioMarketData({ execute }, store);
    const result = Promise.all(["AAPL", "MSFT", "GOOG", "NVDA", "META"].map(symbol => adapter.getQuote(target(symbol))));
    expect(execute).toHaveBeenCalledTimes(5);
    expect(execute.mock.calls.filter(([request]) => request.provider === "frankfurter-v2")).toHaveLength(1);
    pricesReady.resolve();
    await settle();
    expect(execute).toHaveBeenCalledTimes(6);
    rateReady.resolve();
    await settle();
    expect(store.saveRate).toHaveBeenCalledTimes(1);
    saveReady.resolve();
    expect((await result).map(value => value.kind === "success" && value.quote.priceInWon)).toEqual([140000, 140000, 140000, 140000, 140000]);
    expect(maximum).toBe(5);
    expect(active).toBe(0);
  });

  it("keeps the five-minute HTTP TTL but reselects newer durable FX on every completed quote", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-09-06T00:00:00Z").getTime();
    vi.setSystemTime(startedAt);
    const store = observations();
    const execute = vi.fn<SafeExternalTextHttpInputPort["execute"]>(async request => request.provider === "frankfurter-v2" ? rate : price);
    const adapter = new FirebasePortfolioMarketData({ execute }, store);
    await expect(adapter.getQuote(target("AAPL"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 140000 } });
    await store.saveRate({ pair: "USD/KRW", rate: 1450, rateDate: "2026-09-06", observedAt: "2026-09-06T00:00:01Z", provider: "frankfurter-v2" });
    vi.setSystemTime(startedAt + 5 * 60 * 1000 - 1);
    await expect(adapter.getQuote(target("MSFT"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 145000, exchangeRateDate: "2026-09-06", exchangeRateObservedAt: "2026-09-06T00:00:01Z" } });
    expect(execute.mock.calls.filter(([request]) => request.provider === "frankfurter-v2")).toHaveLength(1);
    vi.setSystemTime(startedAt + 5 * 60 * 1000);
    await expect(adapter.getQuote(target("GOOG"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 145000, exchangeRateDate: "2026-09-06" } });
    expect(execute.mock.calls.filter(([request]) => request.provider === "frankfurter-v2")).toHaveLength(2);
  });

  it("shares only in-flight failed FX and fallback reads, then retries the provider on the next quote", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const store = observations();
    await store.saveRate({ pair: "USD/KRW", rate: 1300, rateDate: "2025-01-01", observedAt: "2025-01-01T00:00:00Z", provider: "frankfurter-v2" });
    const fallbackReady = deferred<void>();
    const readRate = store.rate.bind(store);
    vi.spyOn(store, "rate").mockImplementation(async () => { await fallbackReady.promise; return readRate(); });
    let fxAvailable = false;
    const execute = vi.fn<SafeExternalTextHttpInputPort["execute"]>(async request => request.provider === "frankfurter-v2" ? fxAvailable ? rate : unavailable : price);
    const adapter = new FirebasePortfolioMarketData({ execute }, store);
    const results = Promise.all(["AAPL", "MSFT"].map(symbol => adapter.getQuote(target(symbol))));
    await settle();
    expect(store.rate).toHaveBeenCalledTimes(1);
    fallbackReady.resolve();
    for (const result of await results) expect(result).toMatchObject({ kind: "success", quote: { priceInWon: 130000, exchangeRateDate: "2025-01-01" }, providerFailures: [{ provider: "frankfurter-v2", code: "PROVIDER_UNAVAILABLE" }] });
    fxAvailable = true;
    await expect(adapter.getQuote(target("GOOG"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 140000 } });
    expect(execute.mock.calls.filter(([request]) => request.provider === "frankfurter-v2")).toHaveLength(2);
  });

  it("preserves independent successful observations when the other provider has never succeeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const store = observations();
    let fxAvailable = false;
    const execute: SafeExternalTextHttpInputPort["execute"] = async request => request.provider === "frankfurter-v2" ? fxAvailable ? rate : unavailable : fxAvailable ? unavailable : price;
    const adapter = new FirebasePortfolioMarketData({ execute }, store);
    await expect(adapter.getQuote(target("AAPL"))).resolves.toMatchObject({ kind: "failure", code: "EXCHANGE_RATE_NOT_OBSERVED", retryable: true });
    await expect(store.source("AAPL")).resolves.toMatchObject({ sourcePrice: 100 });
    fxAvailable = true;
    await expect(adapter.getQuote(target("AAPL"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 140000 }, providerFailures: [{ provider: "nasdaq-us" }] });
    await expect(store.rate()).resolves.toMatchObject({ rate: 1400, rateDate: "2026-09-05" });
  });

  it("does not retain a rejected FX transaction as a cached in-flight result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const store = observations();
    vi.spyOn(store, "saveRate").mockRejectedValueOnce(new Error("store unavailable"));
    const execute: SafeExternalTextHttpInputPort["execute"] = async request => request.provider === "frankfurter-v2" ? rate : price;
    const adapter = new FirebasePortfolioMarketData({ execute }, store);
    await expect(adapter.getQuote(target("AAPL"))).rejects.toThrow("store unavailable");
    await expect(adapter.getQuote(target("MSFT"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 140000 } });
    expect(store.saveRate).toHaveBeenCalledTimes(2);
  });

  it("returns HTTP slots to queued quotes even when the transport unexpectedly throws", async () => {
    const firstRequests = deferred<void>();
    let started = 0;
    const execute = vi.fn<SafeExternalTextHttpInputPort["execute"]>(async () => {
      started += 1;
      if (started <= 5) { await firstRequests.promise; throw new Error("transport failed"); }
      return response({ closePrice: "70000" });
    });
    const adapter = new FirebasePortfolioMarketData({ execute });
    const results = Promise.allSettled(Array.from({ length: 6 }, (_, index) => adapter.getQuote(target(String(index), "KRX"))));
    expect(execute).toHaveBeenCalledTimes(5);
    firstRequests.resolve();
    const completed = await results;
    expect(completed.slice(0, 5).map(result => result.status)).toEqual(Array(5).fill("rejected"));
    expect(completed[5]).toMatchObject({ status: "fulfilled", value: { kind: "success", quote: { priceInWon: 70000 } } });
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it("does not request FX for an invalid USD symbol", async () => {
    const execute = vi.fn<SafeExternalTextHttpInputPort["execute"]>();
    await expect(new FirebasePortfolioMarketData({ execute }).getQuote(target("US: "))).resolves.toMatchObject({ kind: "failure", code: "INSTRUMENT_NOT_FOUND" });
    expect(execute).not.toHaveBeenCalled();
  });
});
