import { describe, expect, it } from "vitest";

import { createHardenedIngressFixture } from "../../../support/hardened-ingress-fixture";

interface RefreshRunView {
  runId: string;
  householdId: string;
  status: "COMPLETE" | "PARTIAL_FAILURE";
  targetTotal: number;
  processedTargetIds: readonly string[];
  pageSizes: readonly number[];
  createdAt: string;
}

type IngressResult =
  | { kind: "accepted"; run: RefreshRunView }
  | { kind: "no-content"; status: 204 }
  | {
      kind: "rejected";
      code:
        | "METHOD_NOT_ALLOWED"
        | "CONTENT_TYPE_NOT_SUPPORTED"
        | "CONTRACT_VERSION_NOT_SUPPORTED"
        | "BODY_TOO_LARGE"
        | "FIELD_TOO_LARGE"
        | "CORS_ORIGIN_REJECTED"
        | "AUTH_REQUIRED"
        | "APP_CHECK_REJECTED"
        | "HOUSEHOLD_SCOPE_MISMATCH"
        | "RATE_LIMITED"
        | "COST_QUOTA_EXHAUSTED";
    };

interface PublicRefreshRequest {
  method: "POST" | "GET" | "OPTIONS";
  contentType: string;
  contractVersion: string;
  origin: string;
  authToken?: string;
  appCheckToken?: string;
  householdId: string;
  bodyBytes: number;
  largestFieldChars: number;
  requestedAt: string;
}

interface HardenedIngressSeed {
  validAuthToken: string;
  validAppCheckToken: string;
  actorHouseholdId: string;
  allowedOrigins: readonly string[];
  serverDerivedTargetIds: readonly string[];
  limits: {
    maxBodyBytes: number;
    maxFieldChars: number;
    maxPageSize: number;
  };
  quotaAvailable?: boolean;
  rateLimitAvailable?: boolean;
}

/** 공개 refresh ingress와 single-flight 실행 상태의 계약입니다. */
export interface HardenedIngressSubject {
  invoke(request: PublicRefreshRequest): Promise<IngressResult>;
  listRefreshRuns(): readonly RefreshRunView[];
}

export function createSubject(
  seed: HardenedIngressSeed,
): HardenedIngressSubject {
  return createHardenedIngressFixture(seed);
}

const targetIds = Array.from(
  { length: 101 },
  (_, index) => `target-${String(index + 1).padStart(3, "0")}`,
);

const baseSeed = (
  overrides: Partial<HardenedIngressSeed> = {},
): HardenedIngressSeed => ({
  validAuthToken: "valid-auth",
  validAppCheckToken: "valid-app-check",
  actorHouseholdId: "house-1",
  allowedOrigins: ["https://app.example.test"],
  serverDerivedTargetIds: targetIds,
  limits: {
    maxBodyBytes: 8_192,
    maxFieldChars: 256,
    maxPageSize: 50,
  },
  quotaAvailable: true,
  ...overrides,
});

const request = (
  overrides: Partial<PublicRefreshRequest> = {},
): PublicRefreshRequest => ({
  method: "POST",
  contentType: "application/json",
  contractVersion: "1",
  origin: "https://app.example.test",
  authToken: "valid-auth",
  appCheckToken: "valid-app-check",
  householdId: "house-1",
  bodyBytes: 256,
  largestFieldChars: 20,
  requestedAt: "2026-07-20T12:00:00+09:00",
  ...overrides,
});

describe("공개 시세 refresh ingress 보안 계약", () => {
  it.each([
    [
      "CORS 허용 origin이지만 인증 없음",
      { authToken: undefined },
      "AUTH_REQUIRED",
    ],
    [
      "잘못된 App Check",
      { appCheckToken: "wrong-app" },
      "APP_CHECK_REJECTED",
    ],
    [
      "다른 가구 scope",
      { householdId: "house-2" },
      "HOUSEHOLD_SCOPE_MISMATCH",
    ],
  ] as const)(
    "[T-EXT-002][EXT-002] %s 요청은 Application 실행 상태를 만들지 않는다",
    async (_label, overrides, expectedCode) => {
      const subject = createSubject(baseSeed());

      expect(await subject.invoke(request(overrides))).toEqual({
        kind: "rejected",
        code: expectedCode,
      });
      expect(subject.listRefreshRuns()).toEqual([]);
    },
  );

  it.each([
    [{ method: "GET" } as const, "METHOD_NOT_ALLOWED"],
    [
      { contentType: "text/plain" } as const,
      "CONTENT_TYPE_NOT_SUPPORTED",
    ],
    [
      { contractVersion: "999" } as const,
      "CONTRACT_VERSION_NOT_SUPPORTED",
    ],
    [{ bodyBytes: 8_193 } as const, "BODY_TOO_LARGE"],
    [{ largestFieldChars: 257 } as const, "FIELD_TOO_LARGE"],
  ])(
    "[T-EXT-002][EXT-002] method·content·version·body·field 상한 실패는 run을 만들지 않는다",
    async (overrides, expectedCode) => {
      const subject = createSubject(baseSeed());

      expect(await subject.invoke(request(overrides))).toEqual({
        kind: "rejected",
        code: expectedCode,
      });
      expect(subject.listRefreshRuns()).toEqual([]);
    },
  );

  it("[T-EXT-002][EXT-002] CORS preflight는 인증된 업무 context나 refresh run을 만들지 않는다", async () => {
    const subject = createSubject(baseSeed());

    expect(
      await subject.invoke(
        request({
          method: "OPTIONS",
          authToken: undefined,
          appCheckToken: undefined,
        }),
      ),
    ).toEqual({ kind: "no-content", status: 204 });
    expect(subject.listRefreshRuns()).toEqual([]);
  });

  it("[T-EXT-002][EXT-002/DEC-049] 인증된 요청은 101개 server-derived target을 거부하지 않고 내부 50개 page로 모두 처리한다", async () => {
    const subject = createSubject(baseSeed());

    const result = await subject.invoke(request());

    expect(result).toEqual({
      kind: "accepted",
      run: expect.objectContaining({
        householdId: "house-1",
        status: "COMPLETE",
        targetTotal: 101,
        processedTargetIds: targetIds,
        pageSizes: [50, 50, 1],
      }),
    });
    expect(subject.listRefreshRuns()).toEqual([
      result.kind === "accepted" ? result.run : undefined,
    ]);
  });

  it("[T-EXT-002][EXT-002/DEC-049] 같은 actor·가구·범위의 30초 내 중복은 같은 run 최종 상태를 재사용한다", async () => {
    const subject = createSubject(baseSeed());

    const first = await subject.invoke(request());
    const duplicate = await subject.invoke(
      request({ requestedAt: "2026-07-20T12:00:29+09:00" }),
    );

    expect(duplicate).toEqual(first);
    expect(subject.listRefreshRuns()).toEqual([
      first.kind === "accepted" ? first.run : undefined,
    ]);
  });

  it("[T-EXT-002][EXT-002] 비용 quota가 소진되면 인증 후에도 새 refresh run을 만들지 않는다", async () => {
    const subject = createSubject(baseSeed({ quotaAvailable: false }));

    expect(await subject.invoke(request())).toEqual({
      kind: "rejected",
      code: "COST_QUOTA_EXHAUSTED",
    });
    expect(subject.listRefreshRuns()).toEqual([]);
  });

  it.each([
    ["허용하지 않은 origin", baseSeed(), request({ origin: "https://evil.example" }), "CORS_ORIGIN_REJECTED"],
    ["호출 빈도 한도 소진", baseSeed({ rateLimitAvailable: false }), request(), "RATE_LIMITED"],
  ] as const)("[T-EXT-002][EXT-002] %s은 업무 run 생성 전에 거부한다", async (_label, seed, input, code) => {
    const subject = createSubject(seed);

    expect(await subject.invoke(input)).toEqual({ kind: "rejected", code });
    expect(subject.listRefreshRuns()).toEqual([]);
  });

  it("[T-EXT-002][EXT-002] body·field 상한 경계값 자체는 허용한다", async () => {
    const subject = createSubject(baseSeed());

    expect(
      await subject.invoke(request({ bodyBytes: 8_192, largestFieldChars: 256 })),
    ).toMatchObject({ kind: "accepted" });
  });

  it("[T-EXT-002][EXT-002/DEC-049] 30초 single-flight window가 끝나면 새 run을 만든다", async () => {
    const subject = createSubject(baseSeed());

    const first = await subject.invoke(request());
    const next = await subject.invoke(
      request({ requestedAt: "2026-07-20T12:00:30+09:00" }),
    );

    expect(next).not.toEqual(first);
    expect(subject.listRefreshRuns()).toHaveLength(2);
  });
});
