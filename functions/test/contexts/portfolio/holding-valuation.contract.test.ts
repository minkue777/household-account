import { describe, expect, it } from 'vitest';
import { createHoldingValuationFixture } from '../../support/holding-valuation-fixture';

type PositionKind = 'stock' | 'etf' | 'etn' | 'fund' | 'cash' | 'manual' | 'crypto' | 'physical-gold';

interface QuoteObservation {
  priceInWon: number;
  observedAt: string;
  provider: string;
}

interface PositionValuationInput {
  positionId: string;
  kind: PositionKind;
  quantity: number;
  averagePrice?: number;
  priceScale: number;
  lastQuote?: QuoteObservation;
}

interface PositionValuation {
  positionId: string;
  evaluatedPriceSource: 'quote' | 'average-price';
  evaluatedPriceInWon: number;
  evaluatedAmountInWon: number;
  costBasisInWon: number;
  quoteObservedAt?: string;
}

type MarketResult =
  | { kind: 'success'; quote: QuoteObservation }
  | { kind: 'no-data'; code: string }
  | { kind: 'retryable-failure'; code: string }
  | { kind: 'contract-failure'; code: string };

type PositionValuationResult =
  | { kind: 'success'; value: PositionValuation }
  | { kind: 'validation-error'; code: 'INVALID_QUANTITY' | 'INVALID_AVERAGE_PRICE' | 'INVALID_PRICE_SCALE' };

type RefreshedPositionResult =
  | { kind: 'success'; value: PositionValuation; lastQuote: QuoteObservation }
  | {
      kind: 'partial-failure';
      code: string;
      retryable: boolean;
      value: PositionValuation;
      lastQuote?: QuoteObservation;
    };

interface AccountValuation {
  currentBalance: number;
  costBasis: number;
}

/** 공급자·저장 구현과 무관한 Position 및 계좌 평가 계약입니다. */
export interface HoldingValuationSubject {
  valuePosition(input: PositionValuationInput): PositionValuationResult;
  refreshAndValue(input: PositionValuationInput, marketResult: MarketResult): RefreshedPositionResult;
  valueAccount(inputs: readonly PositionValuationInput[]):
    | { kind: 'success'; value: AccountValuation }
    | { kind: 'validation-error'; code: string };
}

export function createSubject(): HoldingValuationSubject {
  return createHoldingValuationFixture();
}

const oldQuote: QuoteObservation = {
  priceInWon: 100,
  observedAt: '2026-07-18T06:00:00.000Z',
  provider: 'market-a',
};

describe('HoldingValuation 공개 계약', () => {
  it('[T-HOLD-003][HOLD-001] Quote를 한 번도 관측하지 못한 Position만 평균단가를 평가가로 사용한다', () => {
    const subject = createSubject();
    const result = subject.valuePosition({
      positionId: 'stock-1',
      kind: 'stock',
      quantity: 10,
      averagePrice: 90,
      priceScale: 1,
    });

    expect(result).toEqual({
      kind: 'success',
      value: {
        positionId: 'stock-1',
        evaluatedPriceSource: 'average-price',
        evaluatedPriceInWon: 90,
        evaluatedAmountInWon: 900,
        costBasisInWon: 900,
      },
    });
  });

  it('[T-HOLD-003][T-MARKET-001][HOLD-002/MARKET-004] 공급자가 성공으로 반환한 0원 Quote를 부재나 실패로 바꾸지 않는다', () => {
    const subject = createSubject();
    const result = subject.refreshAndValue(
      {
        positionId: 'coin-1',
        kind: 'crypto',
        quantity: 3,
        averagePrice: 50,
        priceScale: 1,
        lastQuote: oldQuote,
      },
      {
        kind: 'success',
        quote: {
          priceInWon: 0,
          observedAt: '2026-07-19T06:00:00.000Z',
          provider: 'market-a',
        },
      }
    );

    expect(result).toEqual({
      kind: 'success',
      lastQuote: {
        priceInWon: 0,
        observedAt: '2026-07-19T06:00:00.000Z',
        provider: 'market-a',
      },
      value: expect.objectContaining({
        evaluatedPriceSource: 'quote',
        evaluatedPriceInWon: 0,
        evaluatedAmountInWon: 0,
      }),
    });
  });

  it.each([
    { result: { kind: 'retryable-failure', code: 'TIMEOUT' } as const, retryable: true },
    { result: { kind: 'contract-failure', code: 'RESPONSE_SCHEMA_CHANGED' } as const, retryable: false },
    { result: { kind: 'no-data', code: 'QUOTE_NOT_PUBLISHED' } as const, retryable: false },
  ])(
    '[T-HOLD-003][T-MARKET-001][HOLD-002/MARKET-004] $result.kind 뒤에도 마지막 성공 가격과 observedAt을 그대로 평가한다',
    ({ result: marketResult, retryable }) => {
      const subject = createSubject();
      const result = subject.refreshAndValue(
        {
          positionId: 'stock-1',
          kind: 'stock',
          quantity: 4,
          averagePrice: 90,
          priceScale: 1,
          lastQuote: oldQuote,
        },
        marketResult
      );

      expect(result).toEqual({
        kind: 'partial-failure',
        code: marketResult.code,
        retryable,
        lastQuote: oldQuote,
        value: {
          positionId: 'stock-1',
          evaluatedPriceSource: 'quote',
          evaluatedPriceInWon: 100,
          evaluatedAmountInWon: 400,
          costBasisInWon: 360,
          quoteObservedAt: oldQuote.observedAt,
        },
      });
    }
  );

  it('[T-FUND-001][FUND-001] 펀드 평가액과 원가에 모두 1,000좌당 priceScale을 적용한다', () => {
    const subject = createSubject();
    const result = subject.valuePosition({
      positionId: 'fund-ew001',
      kind: 'fund',
      quantity: 30_000_000,
      averagePrice: 1_000,
      priceScale: 1_000,
      lastQuote: {
        priceInWon: 1_001.19,
        observedAt: '2026-07-19T06:00:00.000Z',
        provider: 'miraeasset',
      },
    });

    expect(result).toEqual({
      kind: 'success',
      value: expect.objectContaining({
        evaluatedAmountInWon: 30_035_700,
        costBasisInWon: 30_000_000,
      }),
    });
  });

  it('[T-HOLD-003][HOLD-002] Position 중간값이 아니라 계좌 합계의 마지막 단계에서 원 단위로 반올림한다', () => {
    const subject = createSubject();
    const result = subject.valueAccount([
      {
        positionId: 'coin-a',
        kind: 'crypto',
        quantity: 1,
        averagePrice: 0.49,
        priceScale: 1,
      },
      {
        positionId: 'coin-b',
        kind: 'crypto',
        quantity: 1,
        averagePrice: 0.49,
        priceScale: 1,
      },
    ]);

    expect(result).toEqual({
      kind: 'success',
      value: { currentBalance: 1, costBasis: 1 },
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '[T-FUND-001][FUND-001] 잘못된 priceScale %s을 1로 추정하지 않고 거부한다',
    (priceScale) => {
      const subject = createSubject();
      const result = subject.valuePosition({
        positionId: 'fund-invalid',
        kind: 'fund',
        quantity: 1_000,
        averagePrice: 1_000,
        priceScale,
      });

      expect(result).toEqual({ kind: 'validation-error', code: 'INVALID_PRICE_SCALE' });
    }
  );
});
