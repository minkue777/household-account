import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebasePortfolioRuntimeStore } from "../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeStore";
import { createPortfolioRuntimeApplication } from "../../../src/contexts/portfolio/core/application/portfolioRuntimeApplication";
import type {
  PortfolioCommandMetadata,
  PortfolioMarketQuotePort,
  PortfolioMarketQuoteResult,
  PortfolioMarketTarget,
  PortfolioProviderHealthPort,
  PortfolioProviderRunObservation,
} from "../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function command(
  sequence: number,
  commandName: string,
  payloadFingerprint = `payload-${sequence}`,
): PortfolioCommandMetadata {
  return {
    householdId: "house-1",
    principalUid: "uid-1",
    actorMemberId: "member-1",
    commandId: `command-${sequence}`,
    idempotencyKey: `idempotency-${sequence}`,
    commandName,
    payloadFingerprint,
    occurredAt: `2026-07-21T0${Math.min(sequence, 9)}:00:00.000Z`,
  };
}

class FixedMarketQuotes implements PortfolioMarketQuotePort {
  readonly calls = new Map<string, number>();

  constructor(
    private readonly resolve: (
      target: PortfolioMarketTarget,
    ) => PortfolioMarketQuoteResult,
  ) {}

  async getQuote(
    target: PortfolioMarketTarget,
  ): Promise<PortfolioMarketQuoteResult> {
    this.calls.set(
      target.instrumentCode,
      (this.calls.get(target.instrumentCode) ?? 0) + 1,
    );
    return this.resolve(target);
  }
}

const unavailableQuotes = new FixedMarketQuotes(() => ({
  kind: "failure",
  code: "MARKET_UNAVAILABLE",
  retryable: true,
}));

function application(
  memory: InMemoryFirestore,
  marketQuotes: PortfolioMarketQuotePort = unavailableQuotes,
  providerHealth?: PortfolioProviderHealthPort,
) {
  return createPortfolioRuntimeApplication({
    store: new FirebasePortfolioRuntimeStore(
      memory as unknown as firestore.Firestore,
    ),
    marketQuotes,
    ...(providerHealth === undefined ? {} : { providerHealth }),
  });
}

async function createStockAsset(
  memory: InMemoryFirestore,
  sequence = 1,
): Promise<string> {
  const result = await application(memory).createAsset({
    metadata: command(sequence, "portfolio.create-asset.v1"),
    asset: {
      name: "Investment account",
      type: "stock",
      ownerRef: { kind: "household" },
      currency: "KRW",
      currentBalance: 0,
      memo: "",
      order: 0,
      isActive: true,
    },
  });
  expect(result.kind).toBe("success");
  if (result.kind !== "success") throw new Error(result.code);
  return result.value.assetId as string;
}

describe("Firebase portfolio runtime store", () => {
  it("uses independent 30-second single-flight leases for household and asset scopes", async () => {
    const memory = new InMemoryFirestore();
    const store = new FirebasePortfolioRuntimeStore(
      memory as unknown as firestore.Firestore,
    );
    const first = command(1, "portfolio.refresh-market-values.v1");
    const competing = {
      ...command(2, "portfolio.refresh-market-values.v1"),
      occurredAt: "2026-07-21T01:00:10.000Z",
    };

    await expect(store.acquireRefreshLease(first, "asset:asset-1")).resolves.toEqual({
      kind: "acquired",
    });
    await expect(
      store.acquireRefreshLease(competing, "asset:asset-1"),
    ).resolves.toEqual({ kind: "busy" });
    await expect(
      store.acquireRefreshLease(competing, "asset:asset-2"),
    ).resolves.toEqual({ kind: "acquired" });
    await expect(
      store.acquireRefreshLease(
        { ...competing, commandId: "command-household" },
        "household",
      ),
    ).resolves.toEqual({ kind: "acquired" });

    expect(memory.paths("households/house-1/operationLocks/")).toHaveLength(3);
    await store.releaseRefreshLease(first, "asset:asset-1");
    await store.releaseRefreshLease(competing, "asset:asset-2");
    await store.releaseRefreshLease(
      { ...competing, commandId: "command-household" },
      "household",
    );
    expect(memory.paths("households/house-1/operationLocks/")).toHaveLength(0);
  });

  it("creates canonical and legacy assets, owner references, plans, receipts and outbox atomically", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1/assetOwnerProfiles/profile-child", {
      householdId: "house-1",
      displayName: "Child",
      lifecycleState: "active",
    });
    const runtime = application(memory);
    const input = {
      metadata: command(1, "portfolio.create-asset.v1"),
      asset: {
        name: "Child savings",
        type: "savings",
        subType: "installment",
        ownerRef: { kind: "profile", profileId: "profile-child" },
        currency: "KRW",
        currentBalance: 1_000_000,
        memo: "",
        order: 0,
        isActive: true,
        recurringContributionAmount: 100_000,
        recurringContributionDay: 25,
      },
    } as const;

    const first = await runtime.createAsset(input);
    const replay = await runtime.createAsset(input);

    expect(first).toEqual(replay);
    expect(first.kind).toBe("success");
    if (first.kind !== "success") return;
    const assetId = first.value.assetId as string;
    expect(memory.document(`households/house-1/assets/${assetId}`)).toMatchObject({
      householdId: "house-1",
      name: "Child savings",
      type: "savings",
      subType: "installment",
      ownerRef: { kind: "profile", profileId: "profile-child" },
      currentBalance: 1_000_000,
      lifecycleState: "active",
      aggregateVersion: 1,
    });
    expect(memory.document(`assets/${assetId}`)).toMatchObject({
      householdId: "house-1",
      owner: "Child",
      ownerRef: { kind: "profile", profileId: "profile-child" },
      isActive: true,
      recurringContributionAmount: 100_000,
      recurringContributionDay: 25,
    });
    const planId = `${assetId}_savings-contribution`;
    expect(
      memory.document(`households/house-1/assetAutomationPlans/${planId}`),
    ).toMatchObject({
      assetId,
      operation: "savings-contribution",
      kind: "savings-deposit",
      status: "active",
      amountInWon: 100_000,
      configuredDay: 25,
      currentRevision: 1,
    });
    expect(
      memory.has(
        `households/house-1/assetAutomationPlanRevisions/${planId}_1`,
      ),
    ).toBe(true);
    expect(memory.paths("commandReceipts/portfolio/receipts/")).toHaveLength(1);
    expect(memory.paths("outboxEvents/")).toHaveLength(1);
  });

  it("preserves an overdue automation checkpoint when its configuration changes", async () => {
    const memory = new InMemoryFirestore();
    const runtime = application(memory);
    const created = await runtime.createAsset({
      metadata: {
        ...command(1, "portfolio.create-asset.v1"),
        occurredAt: "2026-07-01T03:00:00.000Z",
      },
      asset: {
        name: "Recurring savings",
        type: "savings",
        subType: "installment",
        ownerRef: { kind: "household" },
        currency: "KRW",
        currentBalance: 1_000_000,
        memo: "",
        order: 0,
        isActive: true,
        recurringContributionAmount: 100_000,
        recurringContributionDay: 18,
      },
    });
    expect(created.kind).toBe("success");
    if (created.kind !== "success") return;
    const assetId = created.value.assetId as string;
    const planId = `${assetId}_savings-contribution`;

    expect(
      await runtime.updateAsset({
        metadata: {
          ...command(2, "portfolio.update-asset.v1"),
          occurredAt: "2026-07-20T03:00:00.000Z",
        },
        assetId,
        expectedVersion: 1,
        changes: {
          recurringContributionAmount: 200_000,
          recurringContributionDay: 25,
        },
      }),
    ).toEqual({ kind: "success", value: {} });
    expect(
      memory.document(`households/house-1/assetAutomationPlans/${planId}`),
    ).toMatchObject({
      nextDueDate: "2026-07-18",
      amountInWon: 200_000,
      configuredDay: 25,
      currentRevision: 2,
    });
    expect(
      memory.document(
        `households/house-1/assetAutomationPlanRevisions/${planId}_2`,
      ),
    ).toMatchObject({
      effectiveFrom: "2026-07-20T03:00:00.000Z",
      amountInWon: 200_000,
      configuredDay: 25,
    });

    expect(
      await runtime.updateAsset({
        metadata: {
          ...command(3, "portfolio.update-asset.v1"),
          occurredAt: "2026-07-21T03:00:00.000Z",
        },
        assetId,
        expectedVersion: 2,
        changes: { memo: "unrelated change" },
      }),
    ).toEqual({ kind: "success", value: {} });
    expect(
      memory.document(`households/house-1/assetAutomationPlans/${planId}`),
    ).toMatchObject({ nextDueDate: "2026-07-18", currentRevision: 2 });
    expect(
      memory.paths("households/house-1/assetAutomationPlanRevisions/"),
    ).toHaveLength(2);
  });

  it("requires an explicit external stock market and never infers it from a code or holding type", async () => {
    const memory = new InMemoryFirestore();
    const runtime = application(memory);
    const assetId = await createStockAsset(memory);

    const rejected = await runtime.addPosition({
      metadata: command(2, "portfolio.add-position.v1"),
      assetId,
      positionKind: "stock",
      position: {
        assetId,
        holdingType: "stock",
        stockCode: "US:AAPL",
        stockName: "Apple",
        quantity: 2,
        avgPrice: 1_000,
        currentPrice: 1_500,
      },
    });

    expect(rejected).toEqual({
      kind: "error",
      code: "INSTRUMENT_MARKET_REQUIRED",
    });
    expect(memory.paths("stock_holdings/")).toHaveLength(0);
    expect(
      memory.paths(`households/house-1/assets/${assetId}/positions/`),
    ).toHaveLength(0);

    const accepted = await runtime.addPosition({
      metadata: command(3, "portfolio.add-position.v1"),
      assetId,
      positionKind: "stock",
      position: {
        assetId,
        holdingType: "stock",
        stockCode: "US:AAPL",
        stockName: "Apple",
        market: "US",
        exchange: "NASDAQ",
        currency: "USD",
        quantity: 2,
        avgPrice: 1_000,
        currentPrice: 1_500,
      },
    });

    expect(accepted.kind).toBe("success");
    if (accepted.kind !== "success") return;
    const positionId = accepted.value.positionId as string;
    expect(
      memory.document(
        `households/house-1/assets/${assetId}/positions/${positionId}`,
      ),
    ).toMatchObject({
      assetId,
      positionKind: "stock",
      instrumentCode: "US:AAPL",
      market: "US",
      exchange: "NASDAQ",
      currency: "USD",
      quantity: 2,
      averagePriceInWon: 1_000,
      lifecycleState: "active",
      aggregateVersion: 1,
    });
    expect(memory.document(`stock_holdings/${positionId}`)).toMatchObject({
      assetId,
      stockCode: "US:AAPL",
      market: "US",
      currency: "USD",
      currentPrice: 1_500,
    });
    expect(
      memory.paths(`households/house-1/assets/${assetId}/positionHistory/`),
    ).toHaveLength(1);
    expect(memory.document(`households/house-1/assets/${assetId}`)).toMatchObject({
      currentBalance: 3_000,
      costBasis: 2_000,
      aggregateVersion: 2,
    });
  });

  it("rejects stale writes and preserves positions, history, dividends and automation plans on logical asset deletion", async () => {
    const memory = new InMemoryFirestore();
    const runtime = application(memory);
    const assetId = await createStockAsset(memory);
    const added = await runtime.addPosition({
      metadata: command(2, "portfolio.add-position.v1"),
      assetId,
      positionKind: "stock",
      position: {
        assetId,
        holdingType: "stock",
        stockCode: "005930",
        stockName: "Samsung Electronics",
        market: "KRX",
        exchange: "KOSPI",
        currency: "KRW",
        quantity: 10,
        avgPrice: 70_000,
        currentPrice: 80_000,
      },
    });
    expect(added.kind).toBe("success");
    if (added.kind !== "success") return;
    const positionId = added.value.positionId as string;
    memory.seed("households/house-1/dividendEvents/dividend-1", {
      householdId: "house-1",
      assetId,
      positionId,
      status: "paid",
      amountInWon: 5_000,
    });

    const stale = await runtime.updateAsset({
      metadata: command(3, "portfolio.update-asset.v1"),
      assetId,
      expectedVersion: 1,
      changes: { name: "Must not win" },
    });
    expect(stale).toEqual({ kind: "error", code: "ASSET_VERSION_MISMATCH" });
    expect(memory.document(`households/house-1/assets/${assetId}`)).toMatchObject({
      name: "Investment account",
      aggregateVersion: 2,
    });

    expect(
      await runtime.deleteAsset({
        metadata: command(4, "portfolio.delete-asset.v1"),
        assetId,
        expectedVersion: 2,
      }),
    ).toEqual({ kind: "success", value: {} });
    expect(memory.document(`households/house-1/assets/${assetId}`)).toMatchObject({
      lifecycleState: "deleted",
      aggregateVersion: 3,
    });
    expect(memory.document(`assets/${assetId}`)).toMatchObject({
      isActive: false,
      aggregateVersion: 3,
    });
    expect(
      memory.document(
        `households/house-1/assets/${assetId}/positions/${positionId}`,
      ),
    ).toMatchObject({ lifecycleState: "active", quantity: 10 });
    expect(memory.has(`stock_holdings/${positionId}`)).toBe(true);
    expect(
      memory.paths(`households/house-1/assets/${assetId}/positionHistory/`),
    ).toHaveLength(1);
    expect(
      memory.document("households/house-1/dividendEvents/dividend-1"),
    ).toMatchObject({ status: "paid", amountInWon: 5_000 });

    const savings = await runtime.createAsset({
      metadata: command(5, "portfolio.create-asset.v1"),
      asset: {
        name: "Recurring savings",
        type: "savings",
        subType: "installment",
        ownerRef: { kind: "household" },
        currency: "KRW",
        currentBalance: 0,
        memo: "",
        order: 1,
        isActive: true,
        recurringContributionAmount: 100_000,
        recurringContributionDay: 18,
      },
    });
    expect(savings.kind).toBe("success");
    if (savings.kind !== "success") return;
    const savingsId = savings.value.assetId as string;
    const planId = `${savingsId}_savings-contribution`;
    expect(
      await runtime.deleteAsset({
        metadata: command(6, "portfolio.delete-asset.v1"),
        assetId: savingsId,
        expectedVersion: 1,
      }),
    ).toEqual({ kind: "success", value: {} });
    expect(
      memory.document(`households/house-1/assetAutomationPlans/${planId}`),
    ).toMatchObject({ assetId: savingsId, status: "active" });
    expect(
      memory.has(
        `households/house-1/assetAutomationPlanRevisions/${planId}_1`,
      ),
    ).toBe(true);
  });

  it("logically deletes a position while preserving its snapshots and dividend history", async () => {
    const memory = new InMemoryFirestore();
    const runtime = application(memory);
    const assetId = await createStockAsset(memory);
    const added = await runtime.addPosition({
      metadata: command(2, "portfolio.add-position.v1"),
      assetId,
      positionKind: "stock",
      position: {
        assetId,
        holdingType: "stock",
        stockCode: "005930",
        stockName: "Samsung Electronics",
        market: "KRX",
        quantity: 10,
        avgPrice: 70_000,
        currentPrice: 80_000,
      },
    });
    expect(added.kind).toBe("success");
    if (added.kind !== "success") return;
    const positionId = added.value.positionId as string;
    memory.seed("households/house-1/dividendEvents/dividend-1", {
      householdId: "house-1",
      assetId,
      positionId,
      status: "paid",
    });

    expect(
      await runtime.updatePosition({
        metadata: command(3, "portfolio.update-position.v1"),
        assetId,
        positionId,
        positionKind: "stock",
        expectedVersion: 1,
        changes: { quantity: 12 },
      }),
    ).toEqual({ kind: "success", value: {} });
    expect(
      await runtime.deletePosition({
        metadata: command(4, "portfolio.delete-position.v1"),
        assetId,
        positionId,
        positionKind: "stock",
        expectedVersion: 2,
      }),
    ).toEqual({ kind: "success", value: {} });

    expect(
      memory.document(
        `households/house-1/assets/${assetId}/positions/${positionId}`,
      ),
    ).toMatchObject({
      lifecycleState: "deleted",
      quantity: 12,
      aggregateVersion: 3,
    });
    expect(memory.has(`stock_holdings/${positionId}`)).toBe(false);
    expect(
      memory.paths(`households/house-1/assets/${assetId}/positionHistory/`),
    ).toHaveLength(3);
    expect(
      memory.document("households/house-1/dividendEvents/dividend-1"),
    ).toMatchObject({ status: "paid", positionId });
    expect(memory.document(`households/house-1/assets/${assetId}`)).toMatchObject({
      currentBalance: 0,
      costBasis: 0,
    });
  });

  it("[T-HOLD-001][HOLD-001] updates a legacy cash position that has an empty code and no instrument type", async () => {
    const memory = new InMemoryFirestore();
    const assetId = await createStockAsset(memory);
    memory.seed("stock_holdings/legacy-cash-1", {
      householdId: "house-1",
      assetId,
      holdingType: "cash",
      stockCode: "",
      stockName: "예수금",
      quantity: 1,
      currentPrice: 1_000_000,
      aggregateVersion: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(
      await application(memory).updatePosition({
        metadata: command(2, "portfolio.update-position.v1"),
        assetId,
        positionId: "legacy-cash-1",
        positionKind: "stock",
        expectedVersion: 3,
        changes: {
          stockName: "예수금",
          quantity: 1,
          currentPrice: 1_500_000,
        },
      }),
    ).toEqual({ kind: "success", value: {} });

    expect(memory.document("stock_holdings/legacy-cash-1")).toMatchObject({
      holdingType: "cash",
      stockName: "예수금",
      instrumentType: "cash",
      currentPrice: 1_500_000,
      aggregateVersion: 4,
    });
    expect(
      memory.document(
        `households/house-1/assets/${assetId}/positions/legacy-cash-1`,
      ),
    ).toMatchObject({
      instrumentCode: "LEGACY:CASH:LEGACY-CASH-1",
      instrumentType: "cash",
      lastQuote: { priceInWon: 1_500_000 },
      aggregateVersion: 4,
    });
    expect(memory.document(`households/house-1/assets/${assetId}`)).toMatchObject({
      currentBalance: 1_500_000,
      aggregateVersion: 2,
    });
  });

  it("refreshes every supported active target and retains the last successful quote when a provider fails", async () => {
    const memory = new InMemoryFirestore();
    const assetId = await createStockAsset(memory);
    const setup = application(memory);
    const first = await setup.addPosition({
      metadata: command(2, "portfolio.add-position.v1"),
      assetId,
      positionKind: "stock",
      position: {
        assetId,
        holdingType: "stock",
        stockCode: "US:AAPL",
        stockName: "Apple",
        market: "US",
        quantity: 1,
        avgPrice: 90,
        currentPrice: 100,
      },
    });
    const second = await setup.addPosition({
      metadata: command(3, "portfolio.add-position.v1"),
      assetId,
      positionKind: "stock",
      position: {
        assetId,
        holdingType: "stock",
        stockCode: "005930",
        stockName: "Samsung Electronics",
        market: "KRX",
        quantity: 1,
        avgPrice: 150,
        currentPrice: 200,
      },
    });
    expect(first.kind).toBe("success");
    expect(second.kind).toBe("success");
    if (first.kind !== "success" || second.kind !== "success") return;
    const firstId = first.value.positionId as string;
    const secondId = second.value.positionId as string;
    const quotes = new FixedMarketQuotes((target) =>
      target.instrumentCode === "005930"
        ? {
            kind: "success",
            quote: {
              priceInWon: 500,
              observedAt: "2026-07-21T08:00:00.000Z",
              provider: "contract-provider",
            },
            quoteAsOf: "2026-07-21",
          }
        : {
            kind: "failure",
            code: "MARKET_UNAVAILABLE",
            retryable: true,
          },
    );
    const runtime = application(memory, quotes);

    expect(
      await runtime.refreshMarketValues({
        metadata: command(4, "portfolio.refresh-market-values.v1"),
        assetClass: "all",
      }),
    ).toEqual({
      kind: "success",
      value: {
        refreshedCount: 1,
        targetCount: 2,
        retainedLastSuccessCount: 1,
      },
    });
    expect(quotes.calls.get("US:AAPL")).toBe(3);
    expect(quotes.calls.get("005930")).toBe(1);
    expect(memory.document(`stock_holdings/${firstId}`)).toMatchObject({
      currentPrice: 100,
    });
    expect(memory.document(`stock_holdings/${secondId}`)).toMatchObject({
      currentPrice: 500,
      quoteAsOf: "2026-07-21",
    });
    expect(memory.document(`households/house-1/assets/${assetId}`)).toMatchObject({
      currentBalance: 600,
    });
    expect(
      memory.paths(`households/house-1/assets/${assetId}/positionHistory/`),
    ).toHaveLength(2);
    expect(
      memory.has("households/house-1/operationLocks/market-refresh"),
    ).toBe(false);

    const allUnavailable = new FixedMarketQuotes(() => ({
      kind: "failure",
      code: "MARKET_UNAVAILABLE",
      retryable: true,
    }));
    expect(
      await application(memory, allUnavailable).refreshMarketValues({
        metadata: command(5, "portfolio.refresh-market-values.v1"),
        assetClass: "all",
      }),
    ).toEqual({
      kind: "success",
      value: {
        refreshedCount: 0,
        targetCount: 2,
        retainedLastSuccessCount: 2,
      },
    });
    expect(memory.document(`stock_holdings/${firstId}`)).toMatchObject({
      currentPrice: 100,
    });
    expect(memory.document(`stock_holdings/${secondId}`)).toMatchObject({
      currentPrice: 500,
    });
  });

  it("scopes manual refreshes and provider health runs to the selected asset", async () => {
    const memory = new InMemoryFirestore();
    const firstAssetId = await createStockAsset(memory, 1);
    const secondAssetId = await createStockAsset(memory, 2);
    const setup = application(memory);
    const first = await setup.addPosition({
      metadata: command(3, "portfolio.add-position.v1"),
      assetId: firstAssetId,
      positionKind: "stock",
      position: {
        assetId: firstAssetId,
        holdingType: "stock",
        stockCode: "005930",
        stockName: "Samsung Electronics",
        market: "KRX",
        quantity: 1,
        avgPrice: 100,
        currentPrice: 100,
      },
    });
    const second = await setup.addPosition({
      metadata: command(4, "portfolio.add-position.v1"),
      assetId: secondAssetId,
      positionKind: "stock",
      position: {
        assetId: secondAssetId,
        holdingType: "stock",
        stockCode: "005930",
        stockName: "Same code in US market",
        market: "US",
        quantity: 1,
        avgPrice: 200,
        currentPrice: 200,
      },
    });
    expect(first.kind).toBe("success");
    expect(second.kind).toBe("success");
    if (first.kind !== "success" || second.kind !== "success") return;
    const quotes = new FixedMarketQuotes(() => ({
      kind: "success",
      quote: {
        priceInWon: 999,
        observedAt: "2026-07-21T09:00:00.000Z",
        provider: "naver-domestic",
      },
    }));
    const observations: PortfolioProviderRunObservation[] = [];
    const providerHealth: PortfolioProviderHealthPort = {
      async recordRun(observation) {
        observations.push(observation);
      },
    };

    expect(
      await application(memory, quotes, providerHealth).refreshMarketValues({
        metadata: command(5, "portfolio.refresh-market-values.v1"),
        assetClass: "stock",
        assetId: firstAssetId,
      }),
    ).toEqual({
      kind: "success",
      value: {
        refreshedCount: 1,
        targetCount: 1,
        retainedLastSuccessCount: 0,
      },
    });

    expect([...quotes.calls.keys()]).toEqual(["005930"]);
    expect(
      memory.document(`stock_holdings/${first.value.positionId as string}`),
    ).toMatchObject({ currentPrice: 999 });
    expect(
      memory.document(`stock_holdings/${second.value.positionId as string}`),
    ).toMatchObject({ currentPrice: 200 });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      provider: "naver-domestic",
      operation: "market-quote",
      expectedData: true,
      finalResult: { kind: "SUCCESS" },
    });
    expect(memory.paths("households/house-1/operationLocks/")).toHaveLength(0);

    const routedMarkets: PortfolioMarketTarget["market"][] = [];
    const marketAwareQuotes: PortfolioMarketQuotePort = {
      async getQuote(target) {
        routedMarkets.push(target.market);
        return {
          kind: "success",
          quote: {
            priceInWon: target.market === "KRX" ? 111 : 222,
            observedAt: "2026-07-21T09:01:00.000Z",
            provider: target.market === "KRX" ? "naver-domestic" : "nasdaq-us+frankfurter-v2",
          },
        };
      },
    };
    expect(
      await application(memory, marketAwareQuotes).refreshMarketValues({
        metadata: command(6, "portfolio.refresh-market-values.v1"),
        assetClass: "stock",
      }),
    ).toEqual({
      kind: "success",
      value: {
        refreshedCount: 2,
        targetCount: 2,
        retainedLastSuccessCount: 0,
      },
    });
    expect(routedMarkets.sort()).toEqual(["KRX", "US"]);
  });
});
