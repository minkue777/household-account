import { describe, expect, it } from "vitest";

import { createCredentialIngressFixture } from "../../../support/credential-ingress-fixture";

type IngressCredential =
  | {
      kind: "user-id-token";
      credentialId: string;
      actorId: string;
      householdId: string;
      actorLifecycle: "active" | "removed";
      expiresAt: string;
    }
  | {
      kind: "service-account";
      credentialId: string;
      serviceIdentity: string;
      scopes: readonly string[];
      expiresAt: string;
      revoked: boolean;
    }
  | {
      kind: "scoped-credential";
      credentialId: string;
      actorId: string;
      householdId: string;
      scopes: readonly string[];
      expiresAt: string;
      revoked: boolean;
    };

interface CredentialIngressRequest {
  route: "supported-app-refresh" | "operations-refresh";
  origin?: string;
  sourceIp: string;
  credential?: IngressCredential;
  appCheck?: { valid: boolean; appId: string };
  householdId: string;
  requestedAt: string;
}

interface VerifiedIngressContext {
  principalKind: IngressCredential["kind"];
  principalId: string;
  householdId: string;
  grantedScope: "market.refresh";
}

type CredentialIngressResult =
  | {
      kind: "accepted";
      context: VerifiedIngressContext;
      applicationReceiptId: string;
    }
  | {
      kind: "rejected";
      code:
        | "CORS_ORIGIN_REJECTED"
        | "AUTH_REQUIRED"
        | "CREDENTIAL_EXPIRED"
        | "CREDENTIAL_REVOKED"
        | "CREDENTIAL_SCOPE_MISSING"
        | "HOUSEHOLD_SCOPE_MISMATCH"
        | "ACTOR_INACTIVE"
        | "APP_CHECK_REJECTED"
        | "CREDENTIAL_RATE_LIMITED"
        | "IP_RATE_LIMITED";
    };

interface IngressCredentialBoundaryFixture {
  allowedOrigins: readonly string[];
  supportedAppIds: readonly string[];
  exhaustedCredentialIds?: readonly string[];
  exhaustedSourceIps?: readonly string[];
}

/** route별 credential·App Check·CORS·비용 quota 선검증 계약입니다. */
export interface IngressCredentialBoundarySubject {
  invoke(request: CredentialIngressRequest): Promise<CredentialIngressResult>;
  applicationReceipts(): readonly {
    receiptId: string;
    context: VerifiedIngressContext;
  }[];
}

export function createSubject(
  fixture: IngressCredentialBoundaryFixture,
): IngressCredentialBoundarySubject {
  return createCredentialIngressFixture(fixture);
}

const userCredential: Extract<
  IngressCredential,
  { kind: "user-id-token" }
> = {
  kind: "user-id-token",
  credentialId: "user-token-1",
  actorId: "member-a",
  householdId: "house-1",
  actorLifecycle: "active",
  expiresAt: "2026-07-20T13:00:00+09:00",
};

const scopedCredential: Extract<
  IngressCredential,
  { kind: "scoped-credential" }
> = {
  kind: "scoped-credential",
  credentialId: "scoped-1",
  actorId: "operator-a",
  householdId: "house-1",
  scopes: ["market.refresh"],
  expiresAt: "2026-07-20T13:00:00+09:00",
  revoked: false,
};

const seed: IngressCredentialBoundaryFixture = {
  allowedOrigins: ["https://app.example.test"],
  supportedAppIds: ["household-android"],
};

function appRequest(
  overrides: Partial<CredentialIngressRequest> = {},
): CredentialIngressRequest {
  return {
    route: "supported-app-refresh",
    origin: "https://app.example.test",
    sourceIp: "203.0.113.10",
    credential: userCredential,
    appCheck: { valid: true, appId: "household-android" },
    householdId: "house-1",
    requestedAt: "2026-07-20T12:00:00+09:00",
    ...overrides,
  };
}

describe("외부 ingress credential·quota 보안 경계", () => {
  it("[T-EXT-002][EXT-002] 지원 앱 route는 active user credential·허용 origin·App Check가 모두 유효할 때만 context를 만든다", async () => {
    const subject = createSubject(seed);

    const result = await subject.invoke(appRequest());

    expect(result).toEqual({
      kind: "accepted",
      context: {
        principalKind: "user-id-token",
        principalId: "member-a",
        householdId: "house-1",
        grantedScope: "market.refresh",
      },
      applicationReceiptId: expect.any(String),
    });
    expect(subject.applicationReceipts()).toEqual([
      {
        receiptId:
          result.kind === "accepted"
            ? result.applicationReceiptId
            : expect.any(String),
        context:
          result.kind === "accepted" ? result.context : expect.any(Object),
      },
    ]);
  });

  it.each([
    [
      "허용하지 않은 CORS origin",
      { origin: "https://evil.example" },
      "CORS_ORIGIN_REJECTED",
    ],
    [
      "removed actor",
      {
        credential: {
          ...userCredential,
          actorLifecycle: "removed" as const,
        },
      },
      "ACTOR_INACTIVE",
    ],
    [
      "잘못된 App Check app",
      { appCheck: { valid: true, appId: "unknown-app" } },
      "APP_CHECK_REJECTED",
    ],
  ] as const)(
    "[T-EXT-002][EXT-002] %s은 Application receipt를 만들지 않는다",
    async (_label, overrides, code) => {
      const subject = createSubject(seed);

      expect(await subject.invoke(appRequest(overrides))).toEqual({
        kind: "rejected",
        code,
      });
      expect(subject.applicationReceipts()).toEqual([]);
    },
  );

  it.each([
    ["credential 없음", { credential: undefined }, "AUTH_REQUIRED"],
    ["App Check 검증 실패", { appCheck: { valid: false, appId: "household-android" } }, "APP_CHECK_REJECTED"],
    [
      "credential 가구 불일치",
      { householdId: "house-2" },
      "HOUSEHOLD_SCOPE_MISMATCH",
    ],
  ] as const)("[T-EXT-002][EXT-002] %s 요청은 context를 만들지 않는다", async (_label, overrides, code) => {
    const subject = createSubject(seed);

    expect(await subject.invoke(appRequest(overrides))).toEqual({ kind: "rejected", code });
    expect(subject.applicationReceipts()).toEqual([]);
  });

  it("[T-EXT-002][EXT-002] credential 만료 시각과 요청 시각이 같으면 만료로 거부한다", async () => {
    const subject = createSubject(seed);

    expect(
      await subject.invoke({
        route: "operations-refresh",
        sourceIp: "203.0.113.10",
        credential: { ...scopedCredential, expiresAt: "2026-07-20T12:00:00+09:00" },
        householdId: "house-1",
        requestedAt: "2026-07-20T12:00:00+09:00",
      }),
    ).toEqual({ kind: "rejected", code: "CREDENTIAL_EXPIRED" });
  });

  it.each([
    {
      label: "만료",
      credential: {
        ...scopedCredential,
        expiresAt: "2026-07-20T11:59:59+09:00",
      },
      code: "CREDENTIAL_EXPIRED",
    },
    {
      label: "폐기",
      credential: { ...scopedCredential, revoked: true },
      code: "CREDENTIAL_REVOKED",
    },
    {
      label: "scope 누락",
      credential: { ...scopedCredential, scopes: ["market.read"] },
      code: "CREDENTIAL_SCOPE_MISSING",
    },
  ] as const)(
    "[T-EXT-002][EXT-002] scoped credential $label 상태는 업무 호출 전에 거부한다",
    async ({ credential, code }) => {
      const subject = createSubject(seed);

      expect(
        await subject.invoke({
          route: "operations-refresh",
          sourceIp: "203.0.113.10",
          credential,
          householdId: "house-1",
          requestedAt: "2026-07-20T12:00:00+09:00",
        }),
      ).toEqual({ kind: "rejected", code });
      expect(subject.applicationReceipts()).toEqual([]);
    },
  );

  it("[T-EXT-002][EXT-002] 올바른 scope의 service account는 App Check 없이 운영 route를 호출할 수 있다", async () => {
    const serviceCredential: IngressCredential = {
      kind: "service-account",
      credentialId: "service-1",
      serviceIdentity: "asset-job@example.iam.gserviceaccount.com",
      scopes: ["market.refresh"],
      expiresAt: "2026-07-20T13:00:00+09:00",
      revoked: false,
    };
    const subject = createSubject(seed);

    expect(
      await subject.invoke({
        route: "operations-refresh",
        sourceIp: "203.0.113.11",
        credential: serviceCredential,
        householdId: "house-1",
        requestedAt: "2026-07-20T12:00:00+09:00",
      }),
    ).toEqual({
      kind: "accepted",
      context: {
        principalKind: "service-account",
        principalId: "asset-job@example.iam.gserviceaccount.com",
        householdId: "house-1",
        grantedScope: "market.refresh",
      },
      applicationReceiptId: expect.any(String),
    });
    expect(subject.applicationReceipts()).toHaveLength(1);
  });

  it.each([
    {
      label: "credential",
      fixture: { exhaustedCredentialIds: ["scoped-1"] },
      code: "CREDENTIAL_RATE_LIMITED",
    },
    {
      label: "IP",
      fixture: { exhaustedSourceIps: ["203.0.113.10"] },
      code: "IP_RATE_LIMITED",
    },
  ] as const)(
    "[T-EXT-002][EXT-002] $label 비용 quota 소진은 인증 성공 후에도 Application 실행 전 거부한다",
    async ({ fixture, code }) => {
      const subject = createSubject({ ...seed, ...fixture });

      expect(
        await subject.invoke({
          route: "operations-refresh",
          sourceIp: "203.0.113.10",
          credential: scopedCredential,
          householdId: "house-1",
          requestedAt: "2026-07-20T12:00:00+09:00",
        }),
      ).toEqual({ kind: "rejected", code });
      expect(subject.applicationReceipts()).toEqual([]);
    },
  );
});
