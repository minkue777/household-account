import { describe, expect, it } from "vitest";
import { createExternalResultClassificationFixture } from "../../../support/external-result-classification-fixture";

type ExternalResult<T> =
  | { kind: "SUCCESS"; value: T }
  | { kind: "NO_DATA"; reason: string }
  | { kind: "RETRYABLE_FAILURE"; code: string }
  | { kind: "CONTRACT_FAILURE"; code: string }
  | { kind: "INVALID_DATA"; code: string };

type ProviderObservation =
  | { kind: "response"; status: number; payload: unknown }
  | { kind: "timeout" }
  | { kind: "network-error"; code: string };

interface RetryExecution<T> {
  result: ExternalResult<T>;
  attempts: number;
}

interface ExternalResultFixture {
  operation?: () => Promise<ExternalResult<number>>;
  maxAttempts?: number;
}

/** 공급자 payload 해석과 공통 재시도 정책 사이의 공개 경계입니다. */
export interface ExternalResultClassificationSubject {
  mapQuoteObservation(observation: ProviderObservation): ExternalResult<number>;
  mapGoldObservation(observation: ProviderObservation): ExternalResult<number>;
  executeWithRetry(): Promise<RetryExecution<number>>;
}

export function createSubject(
  _fixture: ExternalResultFixture = {},
): ExternalResultClassificationSubject {
  return createExternalResultClassificationFixture(_fixture);
}

describe("External Operations 외부 결과 분류 계약", () => {
  it("[T-EXT-004][EXT-001] 유효한 0원과 공급자가 명시한 데이터 없음은 서로 다른 결과다", () => {
    const subject = createSubject();

    expect(
      subject.mapQuoteObservation({
        kind: "response",
        status: 200,
        payload: { quoteInWon: 0 },
      }),
    ).toEqual({ kind: "SUCCESS", value: 0 });
    expect(
      subject.mapQuoteObservation({
        kind: "response",
        status: 200,
        payload: { availability: "NO_DATA" },
      }),
    ).toEqual({ kind: "NO_DATA", reason: expect.any(String) });
  });

  it.each([
    [{ kind: "timeout" }, "TIMEOUT"],
    [{ kind: "network-error", code: "ECONNRESET" }, "ECONNRESET"],
    [{ kind: "response", status: 408, payload: null }, "HTTP_408"],
    [{ kind: "response", status: 429, payload: null }, "HTTP_429"],
    [{ kind: "response", status: 503, payload: null }, "HTTP_503"],
  ] as const)(
    "[T-EXT-004][EXT-001] 일시 관찰값 %#은 retryable failure로 분류한다",
    (observation, code) => {
      expect(createSubject().mapQuoteObservation(observation)).toEqual({
        kind: "RETRYABLE_FAILURE",
        code,
      });
    },
  );

  it.each([401, 403] as const)(
    "[T-EXT-004][EXT-001] HTTP %i는 데이터 없음이 아니라 운영 계약 실패다",
    (status) => {
      expect(
        createSubject().mapQuoteObservation({
          kind: "response",
          status,
          payload: null,
        }),
      ).toEqual({ kind: "CONTRACT_FAILURE", code: `HTTP_${status}` });
    },
  );

  it.each([
    [{ unexpectedSelector: "changed" }, "QUOTE_SCHEMA_INVALID"],
    [{ quoteInWon: Number.NaN }, "QUOTE_NUMBER_INVALID"],
    [{ quoteInWon: Number.POSITIVE_INFINITY }, "QUOTE_NUMBER_INVALID"],
  ] as const)(
    "[T-EXT-004][EXT-001] schema drift와 비정상 숫자 %#을 성공으로 승인하지 않는다",
    (payload, code) => {
      const result = createSubject().mapQuoteObservation({
        kind: "response",
        status: 200,
        payload,
      });

      expect(result).toEqual(
        code === "QUOTE_SCHEMA_INVALID"
          ? { kind: "CONTRACT_FAILURE", code }
          : { kind: "INVALID_DATA", code },
      );
    },
  );

  it("[T-EXT-004][EXT-001] 금 공급자 실패를 고정 추정 시세 성공으로 바꾸지 않는다", () => {
    const result = createSubject().mapGoldObservation({ kind: "timeout" });

    expect(result).toEqual({ kind: "RETRYABLE_FAILURE", code: "TIMEOUT" });
    expect(result.kind).not.toBe("SUCCESS");
  });

  it.each([
    { terminalKind: "SUCCESS", expectedAttempts: 1 },
    { terminalKind: "NO_DATA", expectedAttempts: 1 },
    { terminalKind: "CONTRACT_FAILURE", expectedAttempts: 1 },
    { terminalKind: "INVALID_DATA", expectedAttempts: 1 },
  ] as const)(
    "[T-EXT-004][EXT-001] $terminalKind 결과는 자동 재시도하지 않는다",
    async ({ terminalKind, expectedAttempts }) => {
      let calls = 0;
      const result = await createSubject({
        operation: async () => {
          calls += 1;
          if (terminalKind === "SUCCESS") {
            return { kind: "SUCCESS", value: 12_345 };
          }
          if (terminalKind === "NO_DATA") {
            return { kind: "NO_DATA", reason: "NOT_LISTED" };
          }
          return { kind: terminalKind, code: "TERMINAL" };
        },
        maxAttempts: 3,
      }).executeWithRetry();

      expect(result.attempts).toBe(expectedAttempts);
      expect(calls).toBe(expectedAttempts);
      expect(result.result.kind).toBe(terminalKind);
    },
  );

  it("[T-EXT-004][EXT-001] retryable 결과만 최대 시도 횟수 안에서 다시 호출한다", async () => {
    let calls = 0;
    const result = await createSubject({
      operation: async () => {
        calls += 1;
        return calls < 3
          ? { kind: "RETRYABLE_FAILURE", code: "HTTP_503" }
          : { kind: "SUCCESS", value: 12_345 };
      },
      maxAttempts: 3,
    }).executeWithRetry();

    expect(result).toEqual({
      result: { kind: "SUCCESS", value: 12_345 },
      attempts: 3,
    });
    expect(calls).toBe(3);
  });
});
