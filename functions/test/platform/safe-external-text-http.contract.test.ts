import { describe, expect, it } from "vitest";

import { createSafeExternalTextHttpApplication } from "../../src/platform/external-operations/application/safeExternalTextHttpApplication";
import type {
  ExternalTextHttpTransportPort,
  ExternalTextHttpTransportResult,
} from "../../src/platform/external-operations/application/ports/out/externalTextHttpTransportPort";

function subject(results: readonly ExternalTextHttpTransportResult[]) {
  let cursor = 0;
  const transport: ExternalTextHttpTransportPort = {
    async execute() {
      return results[Math.min(cursor++, results.length - 1)]!;
    },
  };
  return createSafeExternalTextHttpApplication({
    policy: {
      providers: [
        {
          provider: "KIND",
          allowedHosts: ["kind.krx.co.kr"],
          allowedPorts: [443],
          maxRedirectHops: 2,
        },
      ],
      timeoutMs: 10_000,
      maxAttempts: 3,
      maxResponseBytes: 1_024,
    },
    transport,
  });
}

describe("SafeExternalTextHttp 계약", () => {
  it("timeout은 제한된 횟수만 재시도하고 성공 본문을 반환한다", async () => {
    const result = await subject([
      { kind: "timeout" },
      { kind: "response", status: 200, body: "ok", bodyBytes: 2 },
    ]).execute({
      provider: "KIND",
      operation: "dividend-disclosure",
      url: "https://kind.krx.co.kr/path",
    });
    expect(result).toEqual({
      kind: "success",
      body: "ok",
      finalUrl: "https://kind.krx.co.kr/path",
      responseBytes: 2,
      attempts: 2,
    });
  });

  it("허용 목록 밖 redirect는 실제 다음 요청 없이 차단한다", async () => {
    const result = await subject([
      {
        kind: "response",
        status: 302,
        body: "",
        bodyBytes: 0,
        location: "https://evil.example/steal",
      },
    ]).execute({
      provider: "KIND",
      operation: "dividend-disclosure",
      url: "https://kind.krx.co.kr/path",
    });
    expect(result).toEqual({
      kind: "security-policy-violation",
      code: "PROVIDER_HOST_NOT_ALLOWED",
      attempts: 1,
      httpStatus: 302,
    });
  });

  it("transport가 감지한 최대 응답 크기 초과를 계약 실패로 분류한다", async () => {
    await expect(
      subject([{ kind: "response-too-large", bodyBytes: 1_025 }]).execute({
        provider: "KIND",
        operation: "dividend-disclosure",
        url: "https://kind.krx.co.kr/path",
      }),
    ).resolves.toEqual({
      kind: "contract-failure",
      code: "RESPONSE_TOO_LARGE",
      attempts: 1,
    });
  });

  it("지원하지 않는 HTTP 응답의 상태와 요청 단계를 민감한 URL 없이 보존한다", async () => {
    const result = await subject([
      { kind: "response", status: 403, body: "blocked", bodyBytes: 7 },
    ]).execute({
      provider: "KIND",
      operation: "dividend-disclosure",
      stage: "search",
      url: "https://kind.krx.co.kr/path?instrumentName=sensitive",
    });

    expect(result).toEqual({
      kind: "contract-failure",
      code: "HTTP_STATUS_NOT_SUPPORTED",
      attempts: 1,
      httpStatus: 403,
      stage: "search",
    });
    expect(result).not.toHaveProperty("url");
  });

  it("재시도 가능한 HTTP 실패에도 마지막 상태와 요청 단계를 보존한다", async () => {
    const unavailable = {
      kind: "response" as const,
      status: 503,
      body: "unavailable",
      bodyBytes: 11,
    };
    const result = await subject([unavailable, unavailable, unavailable]).execute({
      provider: "KIND",
      operation: "dividend-disclosure",
      stage: "viewer",
      url: "https://kind.krx.co.kr/path",
    });

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "PROVIDER_UNAVAILABLE",
      attempts: 3,
      httpStatus: 503,
      stage: "viewer",
    });
  });

  it("HTTP 응답이 없는 실패에는 단계만 보존한다", async () => {
    const result = await subject([
      { kind: "timeout" },
      { kind: "timeout" },
      { kind: "timeout" },
    ]).execute({
      provider: "KIND",
      operation: "dividend-disclosure",
      stage: "detail",
      url: "https://kind.krx.co.kr/path",
    });

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "TIMEOUT",
      attempts: 3,
      stage: "detail",
    });
    expect(result).not.toHaveProperty("httpStatus");
  });
});
