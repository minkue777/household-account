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
});
