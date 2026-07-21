import { describe, expect, it } from "vitest";
import type {
  BalanceObservation,
  BalanceView,
  LocalCurrencyBalanceInputPort,
  LocalCurrencyType,
} from "../../../../src/contexts/household-finance/local-currency/public";
import {
  createLocalCurrencyBalanceFixtureSubject,
  type LocalCurrencyBalanceFixture,
} from "../../../support/local-currency-balance-driver";

export interface BalanceObservationSubject
  extends LocalCurrencyBalanceInputPort {
  listForTest(householdId: string): readonly BalanceView[];
  recordedEventCount(): number;
}

export function createSubject(
  fixture: LocalCurrencyBalanceFixture = {},
): BalanceObservationSubject {
  return createLocalCurrencyBalanceFixtureSubject(fixture);
}

function observation(
  observationId: string,
  localCurrencyType: Exclude<LocalCurrencyType, "legacy-unknown">,
  balanceInWon: number,
  observedAt = "2026-07-19T10:00:00+09:00",
): BalanceObservation {
  return {
    observationId,
    householdId: "house-1",
    localCurrencyType,
    balanceInWon,
    observedAt,
  };
}

describe("지역화폐 잔액 관찰 공개 계약", () => {
  it("[T-BAL-002][BAL-002] 같은 가구·같은 유형은 하나의 identity에서 최신값으로 갱신한다", async () => {
    const subject = createSubject();

    const created = await subject.record(observation("obs-1", "gyeonggi", 10_000));
    const updated = await subject.record(
      observation("obs-2", "gyeonggi", 20_000, "2026-07-19T11:00:00+09:00"),
    );

    expect(created).toEqual({
      kind: "success",
      status: "created",
      value: expect.objectContaining({
        localCurrencyType: "gyeonggi",
        balanceInWon: 10_000,
        observedAt: "2026-07-19T10:00:00+09:00",
        updatedAt: expect.any(String),
        balanceVersion: 1,
        schemaVersion: 2,
      }),
    });
    expect(updated).toEqual({
      kind: "success",
      status: "updated",
      value: expect.objectContaining({
        localCurrencyType: "gyeonggi",
        balanceInWon: 20_000,
        balanceVersion: 2,
      }),
    });
    expect(subject.listForTest("house-1")).toHaveLength(1);
  });

  it("[T-BAL-005][BAL-002] 경기·대전·세종 잔액은 서로 다른 identity로 독립 보존한다", async () => {
    const subject = createSubject();

    await subject.record(observation("g", "gyeonggi", 1_000));
    await subject.record(observation("d", "daejeon", 2_000));
    await subject.record(observation("s", "sejong", 3_000));

    const balances = subject
      .listForTest("house-1")
      .map(({ localCurrencyType, balanceInWon }) => ({
        localCurrencyType,
        balanceInWon,
      }));
    expect(balances).toHaveLength(3);
    expect(balances).toEqual(expect.arrayContaining([
      { localCurrencyType: "daejeon", balanceInWon: 2_000 },
      { localCurrencyType: "gyeonggi", balanceInWon: 1_000 },
      { localCurrencyType: "sejong", balanceInWon: 3_000 },
    ]));
  });

  it.each([-1, 0, 1])(
    "[T-BAL-003][T-BAL-007][BAL-003] 부호 있는 정수 %i원을 보정·경고 없이 그대로 보존한다",
    async (balanceInWon) => {
      const result = await createSubject().record(
        observation(`obs-${balanceInWon}`, "gyeonggi", balanceInWon),
      );

      expect(result).toEqual({
        kind: "success",
        status: "created",
        value: expect.objectContaining({ balanceInWon }),
      });
    },
  );

  it.each([1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "[T-BAL-003][BAL-003] 정수가 아닌 잔액 %s은 임의 반올림하지 않고 거부한다",
    async (balanceInWon) => {
      const result = await createSubject().record(
        observation("invalid", "gyeonggi", balanceInWon),
      );

      expect(result).toEqual({
        kind: "validation-error",
        code: "BALANCE_MUST_BE_INTEGER",
      });
    },
  );

  it("[T-BAL-003][BAL-003/DEC-057] 유형 없는 레거시 문서를 특정 지역화폐로 추정하지 않는다", async () => {
    const result = await createSubject({
      legacyWithoutType: {
        balanceId: "legacy-1",
        householdId: "house-1",
        displayName: "지역화폐",
        balanceInWon: 5_000,
        observedAt: "2026-07-01T00:00:00+09:00",
        updatedAt: "2026-07-01T00:00:01+09:00",
        balanceVersion: 1,
        schemaVersion: 1,
      },
    }).get("house-1", "legacy-unknown");

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        localCurrencyType: "legacy-unknown",
        displayName: "지역화폐",
      }),
    });
  });

  it("[T-BAL-004][BAL-004] 명시한 유형의 잔액만 반환하고 임의 첫 문서를 고르지 않는다", async () => {
    const subject = createSubject({
      current: [
        {
          balanceId: "g",
          householdId: "house-1",
          localCurrencyType: "gyeonggi",
          balanceInWon: 1_000,
          observedAt: "2026-07-01T00:00:00+09:00",
          updatedAt: "2026-07-01T00:00:01+09:00",
          balanceVersion: 1,
          schemaVersion: 2,
        },
        {
          balanceId: "s",
          householdId: "house-1",
          localCurrencyType: "sejong",
          balanceInWon: 3_000,
          observedAt: "2026-07-02T00:00:00+09:00",
          updatedAt: "2026-07-02T00:00:01+09:00",
          balanceVersion: 1,
          schemaVersion: 2,
        },
      ],
    });

    expect(await subject.get("house-1", "sejong")).toEqual({
      kind: "success",
      value: expect.objectContaining({
        balanceId: "s",
        localCurrencyType: "sejong",
        balanceInWon: 3_000,
      }),
    });
  });

  it("[T-BAL-006][BAL-004] 조회 실패를 잔액 없음으로 바꾸지 않는다", async () => {
    expect(
      await createSubject({ failRead: true }).get("house-1", "gyeonggi"),
    ).toEqual({
      kind: "retryable-failure",
      code: "BALANCE_REPOSITORY_UNAVAILABLE",
    });
  });

  it("[T-BAL-007][BAL-002/BAL-003] 동시 관찰은 도착 순서와 무관하게 observedAt·observationId 최신값으로 수렴한다", async () => {
    const subject = createSubject();

    await Promise.all([
      subject.record(
        observation("obs-a", "gyeonggi", 1_000, "2026-07-19T10:00:00+09:00"),
      ),
      subject.record(
        observation("obs-b", "gyeonggi", 2_000, "2026-07-19T10:00:00+09:00"),
      ),
    ]);

    expect(await subject.get("house-1", "gyeonggi")).toEqual({
      kind: "success",
      value: expect.objectContaining({
        balanceInWon: 2_000,
      }),
    });
    expect(subject.listForTest("house-1")).toHaveLength(1);
  });

  it("[T-BAL-008][BAL-005] 같은 observation 재생은 최초 결과를 반환하고 version·Event를 다시 늘리지 않는다", async () => {
    const subject = createSubject();
    const input = observation("same", "gyeonggi", 1_000);

    const first = await subject.record(input);
    const replay = await subject.record(input);

    expect(replay).toEqual(first);
    expect(subject.listForTest("house-1")[0].balanceVersion).toBe(1);
    expect(subject.recordedEventCount()).toBe(1);
  });

  it("[T-BAL-008][BAL-005] 같은 observationId의 다른 payload는 기존 잔액을 바꾸지 않는다", async () => {
    const subject = createSubject();
    await subject.record(observation("same", "gyeonggi", 1_000));

    const conflict = await subject.record(
      observation("same", "gyeonggi", 9_999),
    );

    expect(conflict).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(subject.listForTest("house-1")[0].balanceInWon).toBe(1_000);
  });

  it("[T-BAL-008][BAL-005] 오래된 관찰은 receipt만 완료하고 값·version·Event를 바꾸지 않는다", async () => {
    const subject = createSubject();
    await subject.record(
      observation("new", "gyeonggi", 2_000, "2026-07-19T11:00:00+09:00"),
    );

    const stale = await subject.record(
      observation("old", "gyeonggi", 1_000, "2026-07-19T10:00:00+09:00"),
    );

    expect(stale).toEqual({
      kind: "success",
      status: "staleIgnored",
      value: expect.objectContaining({
        balanceInWon: 2_000,
        balanceVersion: 1,
      }),
    });
    expect(subject.recordedEventCount()).toBe(1);
  });
});
