import { describe, expect, it, vi } from "vitest";

import { createHouseholdQueryRouter } from "../../src/bootstrap/queries/householdQueryRouter";
import { createPortfolioMarketHouseholdQueryHandlers } from "../../src/bootstrap/queries/portfolioMarketHouseholdQueryHandlers";

function subject(input: { readonly active?: boolean } = {}) {
  const search = vi.fn(async () => ({
    kind: "success" as const,
    items: [
      {
        market: "KRX" as const,
        instrumentType: "stock" as const,
        code: "005930",
        name: "삼성전자",
      },
    ],
    truncated: false,
    stale: false,
  }));
  const getQuote = vi.fn(async () => ({
    kind: "success" as const,
    quote: {
      priceInWon: 90_000,
      observedAt: "2026-07-21T01:00:00.000Z",
      provider: "naver-domestic",
    },
  }));
  const readDividend = vi.fn(async ({ instrumentCode }: { instrumentCode: string }) => ({
    code: instrumentCode,
    name: "삼성전자",
    recentDividend: 365,
    paymentDate: "2026-06-01",
    frequency: 4,
    dividendYield: null,
    annualDividendPerShare: 1_460,
    isEstimated: false as const,
    paymentEvents: [{ paymentDate: "2026-06-01", dividend: 365 }],
  }));
  const handlers = createPortfolioMarketHouseholdQueryHandlers({
    search: { search },
    quotes: { getQuote },
    dividends: { read: readDividend },
    now: () => new Date("2026-07-21T01:00:00.000Z"),
  });
  const router = createHouseholdQueryRouter({
    handlers,
    memberships: {
      async resolveActor({ principalUid, householdId }) {
        return input.active === false
          ? { kind: "forbidden" as const }
          : {
              kind: "active" as const,
              actor: {
                principalUid,
                householdId,
                actingMemberId: "member-1",
                capabilities: [],
              },
            };
      },
    },
  });
  const execute = (query: string, payload: Record<string, unknown>) =>
    router.execute({
      principalUid: "uid-1",
      request: {
        contractVersion: "household-query.v1",
        queryId: "query-1",
        householdId: "house-1",
        query,
        payload,
      },
    });
  return { execute, search, getQuote, readDividend };
}

describe("Portfolio market household query handlers", () => {
  it("does not call a catalog or market provider before active membership is resolved", async () => {
    const fixture = subject({ active: false });

    await expect(
      fixture.execute("portfolio.search-instruments.v1", {
        assetClass: "crypto",
        query: "비트코인",
      }),
    ).resolves.toMatchObject({ kind: "error", code: "FORBIDDEN" });

    expect(fixture.search).not.toHaveBeenCalled();
    expect(fixture.getQuote).not.toHaveBeenCalled();
  });

  it("routes an explicit market to the shared quote provider without inferring it from code", async () => {
    const fixture = subject();

    await expect(
      fixture.execute("portfolio.get-instrument-quote.v1", {
        market: "US",
        code: "US:AAPL",
        name: "Apple",
        instrumentType: "stock",
        priceScale: 1,
      }),
    ).resolves.toMatchObject({
      kind: "success",
      data: {
        instrument: { market: "US", code: "US:AAPL" },
        priceInWon: 90_000,
        provider: "naver-domestic",
      },
    });

    expect(fixture.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ market: "US", instrumentCode: "US:AAPL" }),
    );
  });

  it("rejects unknown payload fields before any provider call", async () => {
    const fixture = subject();

    await expect(
      fixture.execute("portfolio.get-instrument-quote.v1", {
        market: "KRX",
        code: "005930",
        householdId: "forged-house",
      }),
    ).resolves.toMatchObject({ kind: "error", code: "INVALID_PAYLOAD" });

    expect(fixture.getQuote).not.toHaveBeenCalled();
  });

  it("reads the dividend projection only from the membership-derived household", async () => {
    const fixture = subject();

    await expect(
      fixture.execute("portfolio.get-dividend-projection.v1", {
        instrumentCode: "005930",
      }),
    ).resolves.toMatchObject({
      kind: "success",
      data: { code: "005930", annualDividendPerShare: 1_460 },
    });

    expect(fixture.readDividend).toHaveBeenCalledWith({
      householdId: "house-1",
      instrumentCode: "005930",
      asOfDate: "2026-07-21",
    });
  });
});
