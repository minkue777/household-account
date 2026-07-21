import { describe, expect, it } from "vitest";
import { createForeignCurrencyValuationFixture } from "../../support/foreign-currency-valuation-fixture";

interface SourceQuoteObservation {
  sourcePrice: number;
  sourcePreviousClose: number;
  sourceCurrency: "USD";
  observedAt: string;
  provider: string;
}

interface ExchangeRateObservation {
  pair: "USD/KRW";
  rate: number;
  rateDate: string;
  observedAt: string;
  provider: "frankfurter-v2";
}

interface WonValuationQuote {
  priceInWon: number;
  previousCloseInWon: number;
  quoteObservedAt: string;
  quoteProvider: string;
  exchangeRateDate: string;
  exchangeRateObservedAt: string;
  exchangeRateProvider: "frankfurter-v2";
}

type FrankfurterFixture =
  | {
      kind: "response";
      status: 200;
      body: unknown;
      observedAt: string;
    }
  | { kind: "timeout" }
  | { kind: "schema-drift" };

interface ForeignCurrencyValuationSeed {
  sourceQuote: SourceQuoteObservation;
  storedRate?: ExchangeRateObservation;
  storedWonQuote?: WonValuationQuote;
  providerResults: readonly FrankfurterFixture[];
}

interface ProviderSelectionEvidence {
  selectedProvider: "frankfurter-v2";
  fallbackUsed: false;
}

type RefreshValuationResult =
  | {
      kind: "success";
      value: WonValuationQuote;
      providerSelection: ProviderSelectionEvidence;
    }
  | {
      kind: "partial-failure";
      code: string;
      retainedValue: WonValuationQuote;
      providerSelection: ProviderSelectionEvidence;
    }
  | {
      kind: "no-data";
      code: "EXCHANGE_RATE_NOT_OBSERVED";
      providerSelection: ProviderSelectionEvidence;
    };

interface ProviderHealthView {
  provider: "frankfurter-v2";
  operation: "USD_KRW_RATE";
  status: "healthy" | "degraded" | "outage";
  consecutiveFailedRuns: number;
  alertState: "closed" | "open";
  lastErrorCode?: string;
}

type ValuationEvent =
  | {
      eventType: "PositionChanged.v1";
      priceInWon: number;
      quoteObservedAt: string;
      exchangeRateObservedAt: string;
    }
  | {
      eventType: "AssetValuationChanged.v1";
      currentSignedBalance: number;
    };

/** Frankfurter 관측과 외화 Position 평가를 결합하는 공개 계약입니다. */
export interface ForeignCurrencyValuationSubject {
  refreshAndValue(input: {
    householdId: string;
    assetId: string;
    quantity: number;
    asOfDate: string;
  }): Promise<RefreshValuationResult>;
  currentRate(): ExchangeRateObservation | undefined;
  currentWonQuote(): WonValuationQuote | undefined;
  providerHealth(): ProviderHealthView;
  recordedEvents(): readonly ValuationEvent[];
}

export function createSubject(
  seed: ForeignCurrencyValuationSeed,
): ForeignCurrencyValuationSubject {
  return createForeignCurrencyValuationFixture(seed);
}

const sourceQuote: SourceQuoteObservation = {
  sourcePrice: 100,
  sourcePreviousClose: 99,
  sourceCurrency: "USD",
  observedAt: "2026-07-19T20:00:00.000Z",
  provider: "nasdaq",
};

const storedRate: ExchangeRateObservation = {
  pair: "USD/KRW",
  rate: 1_400,
  rateDate: "2026-07-18",
  observedAt: "2026-07-18T08:00:00.000Z",
  provider: "frankfurter-v2",
};

const storedWonQuote: WonValuationQuote = {
  priceInWon: 140_000,
  previousCloseInWon: 138_600,
  quoteObservedAt: sourceQuote.observedAt,
  quoteProvider: "nasdaq",
  exchangeRateDate: storedRate.rateDate,
  exchangeRateObservedAt: storedRate.observedAt,
  exchangeRateProvider: "frankfurter-v2",
};

const normalResponse = (
  overrides: Partial<{
    date: string;
    base: string;
    quote: string;
    rate: number;
    observedAt: string;
  }> = {},
): FrankfurterFixture => ({
  kind: "response",
  status: 200,
  body: {
    date: "2026-07-20",
    base: "USD",
    quote: "KRW",
    rate: 1_400,
    ...overrides,
  },
  observedAt: overrides.observedAt ?? "2026-07-20T01:00:00.000Z",
});

describe("외화 Quote와 Frankfurter 환율 평가 계약", () => {
  it("[T-MARKET-003][MARKET-001/MARKET-006/DEC-053] 관측 시각 차이와 무관하게 최신 성공 Quote와 환율로 평가하고 provenance를 보존한다", async () => {
    const subject = createSubject({
      sourceQuote,
      providerResults: [normalResponse()],
    });

    const result = await subject.refreshAndValue({
      householdId: "house-1",
      assetId: "asset-us",
      quantity: 1,
      asOfDate: "2026-07-20",
    });

    expect(result).toEqual({
      kind: "success",
      value: {
        priceInWon: 140_000,
        previousCloseInWon: 138_600,
        quoteObservedAt: "2026-07-19T20:00:00.000Z",
        quoteProvider: "nasdaq",
        exchangeRateDate: "2026-07-20",
        exchangeRateObservedAt: "2026-07-20T01:00:00.000Z",
        exchangeRateProvider: "frankfurter-v2",
      },
      providerSelection: {
        selectedProvider: "frankfurter-v2",
        fallbackUsed: false,
      },
    });
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "PositionChanged.v1",
        priceInWon: 140_000,
        quoteObservedAt: sourceQuote.observedAt,
        exchangeRateObservedAt: "2026-07-20T01:00:00.000Z",
      },
      {
        eventType: "AssetValuationChanged.v1",
        currentSignedBalance: 140_000,
      },
    ]);
  });

  it("[T-MARKET-003][MARKET-006/DEC-060] 주말처럼 같은 rateDate의 정상 정정은 새 관측으로 반영한다", async () => {
    const subject = createSubject({
      sourceQuote,
      storedRate,
      storedWonQuote,
      providerResults: [
        normalResponse({
          date: "2026-07-18",
          rate: 1_401,
          observedAt: "2026-07-20T02:00:00.000Z",
        }),
      ],
    });

    const result = await subject.refreshAndValue({
      householdId: "house-1",
      assetId: "asset-us",
      quantity: 1,
      asOfDate: "2026-07-20",
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        priceInWon: 140_100,
        exchangeRateDate: "2026-07-18",
        exchangeRateObservedAt: "2026-07-20T02:00:00.000Z",
      }),
      providerSelection: {
        selectedProvider: "frankfurter-v2",
        fallbackUsed: false,
      },
    });
    expect(subject.currentRate()).toEqual({
      pair: "USD/KRW",
      rate: 1_401,
      rateDate: "2026-07-18",
      observedAt: "2026-07-20T02:00:00.000Z",
      provider: "frankfurter-v2",
    });
  });

  it("[T-MARKET-003][MARKET-004/MARKET-006] 더 오래된 rateDate 응답은 정상 관측과 평가값을 덮어쓰지 않는다", async () => {
    const subject = createSubject({
      sourceQuote,
      storedRate,
      storedWonQuote,
      providerResults: [normalResponse({ date: "2026-07-17", rate: 1_500 })],
    });

    const result = await subject.refreshAndValue({
      householdId: "house-1",
      assetId: "asset-us",
      quantity: 1,
      asOfDate: "2026-07-20",
    });

    expect(result).toEqual({
      kind: "partial-failure",
      code: "STALE_EXCHANGE_RATE_RESPONSE",
      retainedValue: storedWonQuote,
      providerSelection: {
        selectedProvider: "frankfurter-v2",
        fallbackUsed: false,
      },
    });
    expect(subject.currentRate()).toEqual(storedRate);
    expect(subject.currentWonQuote()).toEqual(storedWonQuote);
    expect(subject.recordedEvents()).toEqual([]);
  });

  it.each([
    [normalResponse({ date: "2026-07-21" }), "INVALID_EXCHANGE_RATE_DATE"],
    [normalResponse({ rate: 0 }), "INVALID_EXCHANGE_RATE"],
    [normalResponse({ rate: -1 }), "INVALID_EXCHANGE_RATE"],
    [normalResponse({ base: "EUR" }), "INVALID_EXCHANGE_RATE_PAIR"],
    [{ kind: "schema-drift" } as const, "EXCHANGE_RATE_SCHEMA_CHANGED"],
  ])(
    "[T-MARKET-003][MARKET-006] 미래·0·음수·통화쌍·schema 오류는 저장된 정상값을 변경하지 않는다",
    async (providerResult, expectedCode) => {
      const subject = createSubject({
        sourceQuote,
        storedRate,
        storedWonQuote,
        providerResults: [providerResult],
      });

      const result = await subject.refreshAndValue({
        householdId: "house-1",
        assetId: "asset-us",
        quantity: 1,
        asOfDate: "2026-07-20",
      });

      expect(result).toEqual({
        kind: "partial-failure",
        code: expectedCode,
        retainedValue: storedWonQuote,
        providerSelection: {
          selectedProvider: "frankfurter-v2",
          fallbackUsed: false,
        },
      });
      expect(subject.currentRate()).toEqual(storedRate);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );

  it("[T-MARKET-003][MARKET-006] 환율 성공 이력과 이전 정상 KRW 평가가 모두 없을 때만 NoData를 반환한다", async () => {
    const subject = createSubject({
      sourceQuote,
      providerResults: [{ kind: "timeout" }],
    });

    expect(
      await subject.refreshAndValue({
        householdId: "house-1",
        assetId: "asset-us",
        quantity: 1,
        asOfDate: "2026-07-20",
      }),
    ).toEqual({
      kind: "no-data",
      code: "EXCHANGE_RATE_NOT_OBSERVED",
      providerSelection: {
        selectedProvider: "frankfurter-v2",
        fallbackUsed: false,
      },
    });
    expect(subject.currentRate()).toBeUndefined();
    expect(subject.currentWonQuote()).toBeUndefined();
    expect(subject.recordedEvents()).toEqual([]);
  });

  it("[T-MARKET-003][MARKET-004/MARKET-006/DEC-060] 장기 실패에도 마지막 성공 평가를 유지하고 연속 실패 Health 경보를 연다", async () => {
    const subject = createSubject({
      sourceQuote,
      storedRate,
      storedWonQuote,
      providerResults: [
        { kind: "timeout" },
        { kind: "timeout" },
        { kind: "timeout" },
      ],
    });

    for (let index = 0; index < 3; index += 1) {
      const result = await subject.refreshAndValue({
        householdId: "house-1",
        assetId: "asset-us",
        quantity: 1,
        asOfDate: `2026-07-${20 + index}`,
      });
      expect(result).toEqual({
        kind: "partial-failure",
        code: "EXCHANGE_RATE_TIMEOUT",
        retainedValue: storedWonQuote,
        providerSelection: {
          selectedProvider: "frankfurter-v2",
          fallbackUsed: false,
        },
      });
    }

    expect(subject.currentRate()).toEqual(storedRate);
    expect(subject.currentWonQuote()).toEqual(storedWonQuote);
    expect(subject.providerHealth()).toEqual({
      provider: "frankfurter-v2",
      operation: "USD_KRW_RATE",
      status: "outage",
      consecutiveFailedRuns: 3,
      alertState: "open",
      lastErrorCode: "EXCHANGE_RATE_TIMEOUT",
    });
    expect(subject.recordedEvents()).toEqual([]);
  });
});
