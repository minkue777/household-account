import { describe, expect, it } from "vitest";
import { createBalanceSubscriptionFixtureSubject } from "../../../support/balance-subscription-fixture";

type SupportedLocalCurrencyType = "gyeonggi" | "daejeon" | "sejong";

interface LocalCurrencyBalanceView {
  balanceId: string;
  householdId: string;
  localCurrencyType: SupportedLocalCurrencyType | "legacy-unknown";
  displayName?: string;
  balanceInWon: number;
  observedAt: string;
  updatedAt: string;
  balanceVersion: number;
  schemaVersion: number;
}

type BalanceReadState =
  | { kind: "loading" }
  | { kind: "data"; value: LocalCurrencyBalanceView }
  | { kind: "no-data"; code: "BALANCE_NOT_OBSERVED" }
  | {
      kind: "failed";
      code: string;
      retryable: boolean;
    };

type BalanceSourceOccurrence =
  | { kind: "snapshot"; documents: readonly LocalCurrencyBalanceView[] }
  | { kind: "failure"; code: string; retryable: boolean };

type SubscribeBalanceResult =
  | {
      kind: "subscribed";
      subscriptionId: string;
      states: readonly BalanceReadState[];
    }
  | { kind: "selection-required"; code: "LOCAL_CURRENCY_TYPE_REQUIRED" };

export interface BalanceSubscriptionSubject {
  subscribe(input: {
    householdId: string;
    selectedLocalCurrencyType?: SupportedLocalCurrencyType;
  }): Promise<SubscribeBalanceResult>;
  activeSubscriptionCount(): number;
}

export function createSubject(fixture: {
  occurrences: readonly BalanceSourceOccurrence[];
}): BalanceSubscriptionSubject {
  return createBalanceSubscriptionFixtureSubject(fixture);
}

function balance(
  balanceId: string,
  localCurrencyType: SupportedLocalCurrencyType,
  balanceInWon: number,
  overrides: Partial<LocalCurrencyBalanceView> = {},
): LocalCurrencyBalanceView {
  return {
    balanceId,
    householdId: "house-1",
    localCurrencyType,
    balanceInWon,
    observedAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:01.000Z",
    balanceVersion: 1,
    schemaVersion: 2,
    ...overrides,
  };
}

describe("지역화폐 선택 유형 잔액 구독 공개 계약", () => {
  it("[T-BAL-004][BAL-004] 선택한 유형의 최신값만 loading 이후 data로 내보내고 모든 read field를 보존한다", async () => {
    const firstSejong = balance("sejong", "sejong", 10_000);
    const latestSejong = balance("sejong", "sejong", 20_000, {
      observedAt: "2026-07-20T01:00:00.000Z",
      updatedAt: "2026-07-20T01:00:01.000Z",
      balanceVersion: 2,
    });
    const result = await createSubject({
      occurrences: [
        {
          kind: "snapshot",
          documents: [
            balance("gyeonggi", "gyeonggi", 99_000),
            firstSejong,
            balance("other-house", "sejong", 88_000, {
              householdId: "house-2",
            }),
          ],
        },
        {
          kind: "snapshot",
          documents: [balance("gyeonggi", "gyeonggi", 77_000), latestSejong],
        },
      ],
    }).subscribe({
      householdId: "house-1",
      selectedLocalCurrencyType: "sejong",
    });

    expect(result).toEqual({
      kind: "subscribed",
      subscriptionId: expect.any(String),
      states: [
        { kind: "loading" },
        { kind: "data", value: firstSejong },
        { kind: "data", value: latestSejong },
      ],
    });
    if (result.kind !== "subscribed") return;
    expect(
      result.states
        .filter((state): state is Extract<BalanceReadState, { kind: "data" }> =>
          state.kind === "data",
        )
        .every(
          ({ value }) =>
            value.householdId === "house-1" &&
            value.localCurrencyType === "sejong" &&
            value.updatedAt.length > 0 &&
            value.schemaVersion === 2,
        ),
    ).toBe(true);
  });

  it("[T-BAL-004][BAL-004] 선택 유형이 없으면 임의 첫 문서를 표시하거나 구독을 만들지 않는다", async () => {
    const subject = createSubject({
      occurrences: [
        {
          kind: "snapshot",
          documents: [balance("gyeonggi", "gyeonggi", 10_000)],
        },
      ],
    });

    const result = await subject.subscribe({ householdId: "house-1" });

    expect(result).toEqual({
      kind: "selection-required",
      code: "LOCAL_CURRENCY_TYPE_REQUIRED",
    });
    expect(subject.activeSubscriptionCount()).toBe(0);
  });

  it("[T-BAL-004][BAL-004] 선택 유형의 문서가 없으면 loading과 구분되는 no-data를 내보낸다", async () => {
    const result = await createSubject({
      occurrences: [
        {
          kind: "snapshot",
          documents: [balance("gyeonggi", "gyeonggi", 10_000)],
        },
      ],
    }).subscribe({
      householdId: "house-1",
      selectedLocalCurrencyType: "sejong",
    });

    expect(result).toMatchObject({
      kind: "subscribed",
      states: [
        { kind: "loading" },
        { kind: "no-data", code: "BALANCE_NOT_OBSERVED" },
      ],
    });
  });

  it("[T-BAL-006][BAL-004] listener 실패를 no-data나 직전 정상값으로 축약하지 않는다", async () => {
    const previous = balance("sejong", "sejong", 10_000);
    const result = await createSubject({
      occurrences: [
        { kind: "snapshot", documents: [previous] },
        {
          kind: "failure",
          code: "BALANCE_REPOSITORY_UNAVAILABLE",
          retryable: true,
        },
      ],
    }).subscribe({
      householdId: "house-1",
      selectedLocalCurrencyType: "sejong",
    });

    expect(result).toMatchObject({
      kind: "subscribed",
      states: [
        { kind: "loading" },
        { kind: "data", value: previous },
        {
          kind: "failed",
          code: "BALANCE_REPOSITORY_UNAVAILABLE",
          retryable: true,
        },
      ],
    });
  });
});
