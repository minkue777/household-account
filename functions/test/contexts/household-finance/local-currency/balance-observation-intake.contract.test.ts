import { describe, expect, it } from "vitest";
import { createBalanceObservationIntakeFixtureSubject } from "../../../support/local-currency-balance-driver";

type SupportedLocalCurrencyType = "gyeonggi" | "daejeon" | "sejong";

export interface BalanceRecorderActor {
  kind: "system";
  householdId?: string;
  capabilities: readonly "local-currency.record"[];
}

export interface BalanceObservationV1 {
  contractVersion: "balance-observation.v1";
  observationId: string;
  localCurrencyType: SupportedLocalCurrencyType;
  balanceInWon: number;
  observedAt: string;
  sourceType: string;
  parser: {
    parserId: string;
    parserVersion: string;
  };
  rawPayloadHash?: string;
}

export type BalanceObservationIntakeResult =
  | {
      kind: "success";
      status: "created" | "updated" | "staleIgnored";
      balanceId: string;
      balanceVersion: number;
    }
  | { kind: "forbidden"; code: string }
  | { kind: "validation-error"; code: string }
  | { kind: "contract-failure"; code: string };

export interface BalanceObservationIntakeSnapshot {
  balances: readonly {
    balanceId: string;
    householdId: string;
    localCurrencyType: SupportedLocalCurrencyType;
    balanceInWon: number;
    observedAt: string;
    balanceVersion: number;
  }[];
  receipts: readonly {
    observationId: string;
    resultKind: "created" | "updated" | "staleIgnored";
  }[];
}

export interface LocalCurrencyBalanceChangedEvent {
  eventType: "LocalCurrencyBalanceChanged.v1";
  householdId: string;
  localCurrencyType: SupportedLocalCurrencyType;
  balanceId: string;
  balanceVersion: number;
}

/**
 * Android producer가 만든 BalanceObservation.v1을 받는 Local Currency 공개 경계입니다.
 * parser 원문을 서버에서 재해석하지 않고 typed observation·최종 Balance·Event만 봅니다.
 */
export interface BalanceObservationIntakeSubject {
  recordBalanceObservation(
    actor: BalanceRecorderActor,
    input: BalanceObservationV1,
  ): Promise<BalanceObservationIntakeResult>;
  snapshot(): Promise<BalanceObservationIntakeSnapshot>;
  publishedEvents(): Promise<readonly LocalCurrencyBalanceChangedEvent[]>;
}

export function createSubject(): BalanceObservationIntakeSubject {
  return createBalanceObservationIntakeFixtureSubject();
}

const actor: BalanceRecorderActor = {
  kind: "system",
  householdId: "house-1",
  capabilities: ["local-currency.record"],
};

/** Payment Capture T-PARSE-001 producer가 공개한 원문 없는 DTO snapshot입니다. */
const producerContractExamples: readonly {
  regionName: string;
  observation: BalanceObservationV1;
}[] = [
  {
    regionName: "경기지역화폐",
    observation: {
      contractVersion: "balance-observation.v1",
      observationId: "balance-gyeonggi-1",
      localCurrencyType: "gyeonggi",
      balanceInWon: 123_456,
      observedAt: "2026-07-20T09:00:00+09:00",
      sourceType: "gyeonggi-local-currency",
      parser: {
        parserId: "gyeonggi-local-currency-parser",
        parserVersion: "1.0.0",
      },
      rawPayloadHash: "sha256:gyeonggi-redacted-fixture",
    },
  },
  {
    regionName: "대전사랑카드",
    observation: {
      contractVersion: "balance-observation.v1",
      observationId: "balance-daejeon-1",
      localCurrencyType: "daejeon",
      balanceInWon: 78_900,
      observedAt: "2026-07-20T10:00:00+09:00",
      sourceType: "daejeon-local-currency",
      parser: {
        parserId: "daejeon-local-currency-parser",
        parserVersion: "1.0.0",
      },
      rawPayloadHash: "sha256:daejeon-redacted-fixture",
    },
  },
  {
    regionName: "세종 여민전",
    observation: {
      contractVersion: "balance-observation.v1",
      observationId: "balance-sejong-1",
      localCurrencyType: "sejong",
      balanceInWon: 45_000,
      observedAt: "2026-07-20T11:00:00+09:00",
      sourceType: "sejong-local-currency",
      parser: {
        parserId: "sejong-local-currency-parser",
        parserVersion: "1.0.0",
      },
      rawPayloadHash: "sha256:sejong-redacted-fixture",
    },
  },
];

describe("지역화폐 BalanceObservation.v1 consumer intake 공개 계약", () => {
  it.each(producerContractExamples)(
    "[T-BAL-001][BAL-001] Payment Capture producer의 $regionName DTO는 정수 잔액과 확정 type으로 저장된다",
    async ({ observation }) => {
      const subject = createSubject();

      const result = await subject.recordBalanceObservation(actor, observation);

      expect(result).toEqual({
        kind: "success",
        status: "created",
        balanceId: expect.any(String),
        balanceVersion: 1,
      });
      if (result.kind !== "success") {
        throw new Error("검증된 잔액 관찰 저장에 실패했습니다.");
      }
      expect(await subject.snapshot()).toEqual({
        balances: [
          {
            balanceId: result.balanceId,
            householdId: "house-1",
            localCurrencyType: observation.localCurrencyType,
            balanceInWon: observation.balanceInWon,
            observedAt: observation.observedAt,
            balanceVersion: 1,
          },
        ],
        receipts: [
          {
            observationId: observation.observationId,
            resultKind: "created",
          },
        ],
      });
      expect(await subject.publishedEvents()).toEqual([
        {
          eventType: "LocalCurrencyBalanceChanged.v1",
          householdId: "house-1",
          localCurrencyType: observation.localCurrencyType,
          balanceId: result.balanceId,
          balanceVersion: 1,
        },
      ]);
      expect(observation).not.toHaveProperty("paymentObservation");
      expect(observation).not.toHaveProperty("rawPayload");
    },
  );

  it("[T-BAL-001][BAL-001] household scope가 없는 SystemActor는 유효한 fixture도 저장하지 못한다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();

    const result = await subject.recordBalanceObservation(
      {
        kind: "system",
        capabilities: ["local-currency.record"],
      },
      producerContractExamples[0].observation,
    );

    expect(result).toEqual({
      kind: "forbidden",
      code: "HOUSEHOLD_SCOPE_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-BAL-001][BAL-001] Local Currency 기록 capability가 없는 Actor는 가구 scope가 있어도 저장하지 못한다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();
    const actorWithoutCapability = {
      kind: "system",
      householdId: "house-1",
      capabilities: [],
    } as unknown as BalanceRecorderActor;

    const result = await subject.recordBalanceObservation(
      actorWithoutCapability,
      producerContractExamples[0].observation,
    );

    expect(result).toEqual({
      kind: "forbidden",
      code: "LOCAL_CURRENCY_RECORD_CAPABILITY_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it.each([
    [1.5, "BALANCE_MUST_BE_INTEGER"],
    [Number.NaN, "BALANCE_MUST_BE_INTEGER"],
    [Number.POSITIVE_INFINITY, "BALANCE_MUST_BE_INTEGER"],
  ] as const)(
    "[T-BAL-001][BAL-001] 정수가 아닌 잔액 %s은 %s로 거부하고 Balance·receipt·Event를 만들지 않는다",
    async (balanceInWon, code) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      const result = await subject.recordBalanceObservation(actor, {
        ...producerContractExamples[0].observation,
        observationId: `invalid-${String(balanceInWon)}`,
        balanceInWon,
      });

      expect(result).toEqual({ kind: "validation-error", code });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it.each([
    [
      "지원하지 않는 contract version",
      { contractVersion: "balance-observation.v2" },
      "UNSUPPORTED_OBSERVATION_VERSION",
    ],
    [
      "지원하지 않는 지역화폐 type",
      { localCurrencyType: "unknown-region" },
      "UNSUPPORTED_LOCAL_CURRENCY_TYPE",
    ],
  ] as const)(
    "[T-BAL-001][BAL-001] %s은 원문 저장 fallback 없이 %s로 계약 실패한다",
    async (_name, overrides, code) => {
      const subject = createSubject();
      const before = await subject.snapshot();
      const unsupported = {
        ...producerContractExamples[0].observation,
        ...overrides,
        observationId: `unsupported-${code}`,
      } as unknown as BalanceObservationV1;

      const result = await subject.recordBalanceObservation(actor, unsupported);

      expect(result).toEqual({ kind: "contract-failure", code });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it.each([
    ["관찰 ID", { observationId: "" }, "OBSERVATION_ID_REQUIRED"],
    ["관찰 시각", { observedAt: "not-an-instant" }, "INVALID_OBSERVED_AT"],
    ["source type", { sourceType: "  " }, "SOURCE_TYPE_REQUIRED"],
    [
      "parser ID",
      { parser: { parserId: "", parserVersion: "1.0.0" } },
      "PARSER_METADATA_REQUIRED",
    ],
    [
      "parser version",
      {
        parser: {
          parserId: "gyeonggi-local-currency-parser",
          parserVersion: "",
        },
      },
      "PARSER_METADATA_REQUIRED",
    ],
  ] as const)(
    "[T-BAL-001][BAL-001] 필수 %s가 유효하지 않으면 %s이며 상태를 만들지 않는다",
    async (_name, overrides, code) => {
      const subject = createSubject();
      const before = await subject.snapshot();
      const invalid = {
        ...producerContractExamples[0].observation,
        ...overrides,
      } as BalanceObservationV1;

      const result = await subject.recordBalanceObservation(actor, invalid);

      expect(result).toEqual({ kind: "validation-error", code });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it("[T-BAL-001][BAL-001] 금융 알림 원문이 섞인 observation은 서버가 재parse하지 않고 입력 계약에서 거부한다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();
    const withRawPayload: BalanceObservationV1 & { rawPayload: string } = {
      ...producerContractExamples[0].observation,
      observationId: "observation-with-raw-payload",
      rawPayload: "민감한 금융 알림 원문",
    };

    const result = await subject.recordBalanceObservation(actor, withRawPayload);

    expect(result).toEqual({
      kind: "validation-error",
      code: "RAW_PAYLOAD_NOT_ALLOWED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });
});
