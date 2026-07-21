import { describe, expect, it } from "vitest";
import { createSafeExternalHttpFixture } from "../../../support/safe-external-http-fixture";

type HttpScriptStep =
  | { kind: "response"; status: number; bodyBytes: number }
  | { kind: "redirect"; status: 301 | 302 | 307 | 308; location: string }
  | { kind: "timeout" }
  | { kind: "chunked-response"; status: 200; chunks: readonly number[] };

interface ProviderHttpTarget {
  targetId: string;
  provider: string;
  url: string;
}

type ProviderHttpOutcome =
  | { targetId: string; kind: "success"; attempts: number }
  | {
      targetId: string;
      kind: "retryable-failure";
      code: "TIMEOUT" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE";
      attempts: number;
    }
  | {
      targetId: string;
      kind: "security-policy-violation";
      code:
        | "HTTPS_REQUIRED"
        | "HOST_NOT_ALLOWED"
        | "REDIRECT_NOT_ALLOWED";
      attempts: number;
    }
  | {
      targetId: string;
      kind: "contract-failure";
      code: "RESPONSE_TOO_LARGE" | "HTTP_STATUS_NOT_SUPPORTED";
      attempts: number;
    };

interface ProviderHttpRunResult {
  outcomes: readonly ProviderHttpOutcome[];
  maxObservedConcurrency: number;
  completed: true;
}

interface SafeExternalHttpSeed {
  policy: {
    allowedHttpsHosts: readonly string[];
    allowedPorts: readonly number[];
    timeoutMs: 10_000;
    maxResponseBytes: number;
    maxRedirectHops: number;
    maxConcurrency: 5;
    maxAttempts: 3;
  };
  scripts: Readonly<Record<string, readonly HttpScriptStep[]>>;
}

/** SafeExternalHttpClient와 retry·concurrency 경계의 공개 실행 계약입니다. */
export interface SafeExternalHttpSubject {
  executeBatch(
    targets: readonly ProviderHttpTarget[],
  ): Promise<ProviderHttpRunResult>;
}

export function createSubject(
  _seed: SafeExternalHttpSeed,
): SafeExternalHttpSubject {
  return createSafeExternalHttpFixture(_seed);
}

const policy: SafeExternalHttpSeed["policy"] = {
  allowedHttpsHosts: ["api.provider.test", "cdn.provider.test"],
  allowedPorts: [443],
  timeoutMs: 10_000,
  maxResponseBytes: 1_024,
  maxRedirectHops: 2,
  maxConcurrency: 5,
  maxAttempts: 3,
};

const target = (
  targetId: string,
  url = `https://api.provider.test/${targetId}`,
): ProviderHttpTarget => ({
  targetId,
  provider: "test-provider",
  url,
});

describe("외부 HTTP 안전 경계 계약", () => {
  it.each([
    [
      "HTTP downgrade",
      target("plain-http", "http://api.provider.test/value"),
      { kind: "security-policy-violation", code: "HTTPS_REQUIRED", attempts: 0 },
    ],
    [
      "allowlist 밖 최초 host",
      target("wrong-host", "https://evil.example/value"),
      {
        kind: "security-policy-violation",
        code: "HOST_NOT_ALLOWED",
        attempts: 0,
      },
    ],
  ] as const)(
    "[T-EXT-003][EXT-003] %s 요청은 network 실행 전 bounded security 결과로 끝난다",
    async (_label, requestTarget, expected) => {
      const result = await createSubject({ policy, scripts: {} }).executeBatch([
        requestTarget,
      ]);

      expect(result).toEqual({
        outcomes: [{ targetId: requestTarget.targetId, ...expected }],
        maxObservedConcurrency: 0,
        completed: true,
      });
    },
  );

  it("[T-EXT-003][EXT-003] redirect의 모든 Location을 재검증해 외부 host 이동을 거부한다", async () => {
    const result = await createSubject({
      policy,
      scripts: {
        "https://api.provider.test/redirect-out": [
          {
            kind: "redirect",
            status: 302,
            location: "https://evil.example/secret",
          },
        ],
      },
    }).executeBatch([target("redirect-out")]);

    expect(result.outcomes).toEqual([
      {
        targetId: "redirect-out",
        kind: "security-policy-violation",
        code: "REDIRECT_NOT_ALLOWED",
        attempts: 1,
      },
    ]);
  });

  it("[T-EXT-003][EXT-003] allowlist HTTPS redirect와 bounded 정상 응답은 성공한다", async () => {
    const result = await createSubject({
      policy,
      scripts: {
        "https://api.provider.test/redirect-in": [
          {
            kind: "redirect",
            status: 302,
            location: "https://cdn.provider.test/value",
          },
        ],
        "https://cdn.provider.test/value": [
          { kind: "response", status: 200, bodyBytes: 100 },
        ],
      },
    }).executeBatch([target("redirect-in")]);

    expect(result).toEqual({
      outcomes: [{ targetId: "redirect-in", kind: "success", attempts: 1 }],
      maxObservedConcurrency: 1,
      completed: true,
    });
  });

  it.each([
    [{ kind: "timeout" } as const, "TIMEOUT"],
    [
      { kind: "response", status: 429, bodyBytes: 0 } as const,
      "RATE_LIMITED",
    ],
    [
      { kind: "response", status: 503, bodyBytes: 0 } as const,
      "PROVIDER_UNAVAILABLE",
    ],
  ])(
    "[T-EXT-003][EXT-003/DEC-049] timeout·429·5xx만 총 3회 시도 후 retryable failure로 종료한다",
    async (step, code) => {
      const url = "https://api.provider.test/retryable";
      const result = await createSubject({
        policy,
        scripts: { [url]: [step, step, step] },
      }).executeBatch([target("retryable")]);

      expect(result.outcomes).toEqual([
        {
          targetId: "retryable",
          kind: "retryable-failure",
          code,
          attempts: 3,
        },
      ]);
    },
  );

  it("[T-EXT-003][EXT-003] retryable이 아닌 HTTP 계약 실패는 자동 재시도하지 않는다", async () => {
    const url = "https://api.provider.test/permanent";
    const result = await createSubject({
      policy,
      scripts: {
        [url]: [
          { kind: "response", status: 404, bodyBytes: 100 },
          { kind: "response", status: 200, bodyBytes: 100 },
        ],
      },
    }).executeBatch([target("permanent")]);

    expect(result.outcomes).toEqual([
      {
        targetId: "permanent",
        kind: "contract-failure",
        code: "HTTP_STATUS_NOT_SUPPORTED",
        attempts: 1,
      },
    ]);
  });

  it.each([
    [
      "Content-Length가 있는 초과 응답",
      { kind: "response", status: 200, bodyBytes: 1_025 } as const,
    ],
    [
      "Content-Length가 없는 chunked 초과 응답",
      { kind: "chunked-response", status: 200, chunks: [500, 500, 25] } as const,
    ],
  ])(
    "[T-EXT-003][EXT-003] %s은 최대 byte에서 읽기를 중단하고 성공·NoData로 축약하지 않는다",
    async (_label, step) => {
      const url = "https://api.provider.test/large";
      const result = await createSubject({
        policy,
        scripts: { [url]: [step] },
      }).executeBatch([target("large")]);

      expect(result.outcomes).toEqual([
        {
          targetId: "large",
          kind: "contract-failure",
          code: "RESPONSE_TOO_LARGE",
          attempts: 1,
        },
      ]);
    },
  );

  it("[T-EXT-003][EXT-003/DEC-049] 여섯 target을 함께 실행해도 관찰된 Provider 동시 실행은 최대 5다", async () => {
    const targets = Array.from({ length: 6 }, (_, index) =>
      target(`batch-${index + 1}`),
    );
    const scripts = Object.fromEntries(
      targets.map(({ url }) => [
        url,
        [{ kind: "response", status: 200, bodyBytes: 10 } as const],
      ]),
    );

    const result = await createSubject({ policy, scripts }).executeBatch(targets);

    expect(result.completed).toBe(true);
    expect(result.maxObservedConcurrency).toBeLessThanOrEqual(5);
    expect(result.outcomes).toEqual(
      targets.map(({ targetId }) => ({
        targetId,
        kind: "success",
        attempts: 1,
      })),
    );
  });
});
