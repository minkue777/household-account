import { describe, expect, it } from "vitest";
import { createGoldPositionAndProviderFixture } from "../../support/gold-position-and-provider-fixture";

interface GoldPositionView {
  positionId: string;
  kind: "physical-gold" | "gold-etf";
  normalizedQuantity: number;
  evaluatedAmountInWon: number;
  quoteObservedAt?: string;
}

type GoldProviderResult =
  | { kind: "success"; wonPerDon: number; observedAt: string }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string }
  | { kind: "fixed-fallback"; wonPerDon: number };

type RefreshGoldResult =
  | { kind: "success"; value: GoldPositionView }
  | {
      kind: "partial-failure" | "contract-failure";
      code: string;
      retained: GoldPositionView;
    };

export interface GoldPositionAndProviderSubject {
  normalizeAndValue(input: {
    positionId: string;
    kind: "physical-gold" | "gold-etf";
    quantity?: number;
    legacyMemo?: string;
    quoteInWon: number;
  }): GoldPositionView;
  refreshPhysicalGold(result: GoldProviderResult): RefreshGoldResult;
  currentPosition(): GoldPositionView;
  recordedEvents(): readonly {
    eventType: "PositionChanged.v1" | "AssetValuationChanged.v1";
  }[];
}

export function createSubject(seed: {
  currentPosition: GoldPositionView;
}): GoldPositionAndProviderSubject {
  return createGoldPositionAndProviderFixture(seed);
}

const current: GoldPositionView = {
  positionId: "gold-physical",
  kind: "physical-gold",
  normalizedQuantity: 3,
  evaluatedAmountInWon: 1_500_000,
  quoteObservedAt: "2026-07-18T06:00:00.000Z",
};

describe("실물 금·금 ETF 평가와 공급자 실패 계약", () => {
  it.each(["3돈", "3 돈"])(
    "[T-GOLD-001][GOLD-001] legacy memo %s를 3돈 수량으로 정규화한다",
    (legacyMemo) => {
      const result = createSubject({ currentPosition: current }).normalizeAndValue({
        positionId: "legacy-gold",
        kind: "physical-gold",
        legacyMemo,
        quoteInWon: 500_000,
      });

      expect(result).toEqual({
        positionId: "legacy-gold",
        kind: "physical-gold",
        normalizedQuantity: 3,
        evaluatedAmountInWon: 1_500_000,
        quoteObservedAt: undefined,
      });
    },
  );

  it("[T-GOLD-001][GOLD-001] 정규 quantity가 있으면 legacy memo보다 우선하고 금 ETF는 주식 수량 방식으로 평가한다", () => {
    const subject = createSubject({ currentPosition: current });

    expect(
      subject.normalizeAndValue({
        positionId: "normalized-gold",
        kind: "physical-gold",
        quantity: 2,
        legacyMemo: "99돈",
        quoteInWon: 500_000,
      }),
    ).toEqual(
      expect.objectContaining({
        normalizedQuantity: 2,
        evaluatedAmountInWon: 1_000_000,
      }),
    );
    expect(
      subject.normalizeAndValue({
        positionId: "gold-etf",
        kind: "gold-etf",
        quantity: 3,
        quoteInWon: 15_000,
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "gold-etf",
        normalizedQuantity: 3,
        evaluatedAmountInWon: 45_000,
      }),
    );
  });

  it.each([
    [{ kind: "retryable-failure", code: "TIMEOUT" } as const, "partial-failure", "TIMEOUT"],
    [{ kind: "retryable-failure", code: "HTTP_500" } as const, "partial-failure", "HTTP_500"],
    [
      { kind: "contract-failure", code: "RESPONSE_SCHEMA_CHANGED" } as const,
      "contract-failure",
      "RESPONSE_SCHEMA_CHANGED",
    ],
    [
      { kind: "fixed-fallback", wonPerDon: 500_000 } as const,
      "contract-failure",
      "ESTIMATED_GOLD_FALLBACK_FORBIDDEN",
    ],
  ] as const)(
    "[T-GOLD-002][GOLD-002] 공급자 %s는 추정 성공이나 0원으로 바꾸지 않고 마지막 정상 평가를 유지한다",
    async (providerResult, expectedKind, code) => {
      const subject = createSubject({ currentPosition: current });

      expect(subject.refreshPhysicalGold(providerResult)).toEqual({
        kind: expectedKind,
        code,
        retained: current,
      });
      expect(subject.currentPosition()).toEqual(current);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );
});
