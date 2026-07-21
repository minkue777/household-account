import { describe, expect, it } from "vitest";

import { createNativeGoogleSessionHandoffFixture } from "../../../support/native-google-session-handoff-fixture";

export type NativeGoogleAuthenticationResult =
  | { kind: "Authenticated"; principalRef: string; membershipRequired: true }
  | { kind: "Cancelled" }
  | { kind: "Failed"; code: "GOOGLE_AUTH_FAILED" };

export type MembershipHandoffResult =
  | {
      kind: "SessionReady";
      principalRef: string;
      exchangeHandle: string;
      expiresAt: string;
    }
  | {
      kind: "Rejected";
      code:
        | "AUTHENTICATION_REQUIRED"
        | "ACTIVE_MEMBERSHIP_REQUIRED"
        | "MEMBERSHIP_PRINCIPAL_MISMATCH"
        | "MEMBERSHIP_LOOKUP_FAILED";
    };

export interface PrincipalBoundMembershipReceipt {
  receiptId: string;
  principalRef: string;
  householdId: string;
  memberId: string;
  status: "active" | "deleted";
  source: "trusted-membership-query";
}

export type MembershipLookupResult =
  | { kind: "Found"; receipt: PrincipalBoundMembershipReceipt }
  | { kind: "Missing" }
  | { kind: "Failed" };

export const WEBVIEW_SESSION_EXCHANGE_MAX_TTL_MS = 5 * 60 * 1_000;

export interface NativeGoogleSessionState {
  authSurface: "android-credential-manager";
  firebaseAdapter: "android-native-sdk";
  embeddedWebOauthOpened: boolean;
  principalRef?: string;
  sessionMirror?: {
    schemaVersion: 1;
    sessionGeneration: string;
    householdId: string;
    memberId: string;
  };
  issuedExchangeHandles: readonly string[];
  membershipLookupPrincipalRefs: readonly string[];
  exposedBridgeValues: readonly string[];
}

export interface NativeGoogleSessionHandoffContractSubject {
  authenticate(
    outcome:
      | { kind: "success"; principalRef: string }
      | { kind: "cancel" }
      | { kind: "failure" },
  ): Promise<NativeGoogleAuthenticationResult>;
  confirmMembership(): Promise<MembershipHandoffResult>;
  state(): NativeGoogleSessionState;
}

export function createSubject(fixture: {
  membershipLookupByPrincipal: Readonly<Record<string, MembershipLookupResult>>;
  serverNow: string;
  requestedExchangeHandleTtlMs?: number;
  untrustedClientHints?: {
    householdId?: string;
    memberId?: string;
    status?: "active" | "deleted";
  };
}): NativeGoogleSessionHandoffContractSubject {
  return createNativeGoogleSessionHandoffFixture(fixture);
}

const serverNow = "2026-07-20T10:00:00+09:00";

const activeReceipt = (
  overrides: Partial<PrincipalBoundMembershipReceipt> = {},
): PrincipalBoundMembershipReceipt => ({
  receiptId: "membership-receipt-1",
  principalRef: "principal:user-1",
  householdId: "household-1",
  memberId: "member-1",
  status: "active",
  source: "trusted-membership-query",
  ...overrides,
});

const subjectWithLookup = (
  result: MembershipLookupResult = { kind: "Found", receipt: activeReceipt() },
  overrides: Partial<Parameters<typeof createSubject>[0]> = {},
): NativeGoogleSessionHandoffContractSubject =>
  createSubject({
    membershipLookupByPrincipal: { "principal:user-1": result },
    serverNow,
    ...overrides,
  });

describe("Android Native Google 인증·Web session 인계 공개 계약", () => {
  it("[T-WEBVIEW-001][AND-005] Native 인증만으로는 mirror를 만들지 않고 활성 Membership 확인 뒤 안정 ID snapshot과 짧은 일회성 handle을 만든다", async () => {
    const subject = subjectWithLookup();

    expect(
      await subject.authenticate({
        kind: "success",
        principalRef: "principal:user-1",
      }),
    ).toEqual({
      kind: "Authenticated",
      principalRef: "principal:user-1",
      membershipRequired: true,
    });
    expect(subject.state()).toMatchObject({
      authSurface: "android-credential-manager",
      firebaseAdapter: "android-native-sdk",
      embeddedWebOauthOpened: false,
      principalRef: "principal:user-1",
      sessionMirror: undefined,
      issuedExchangeHandles: [],
      membershipLookupPrincipalRefs: [],
      exposedBridgeValues: [],
    });

    const result = await subject.confirmMembership();

    expect(result).toEqual({
      kind: "SessionReady",
      principalRef: "principal:user-1",
      exchangeHandle: expect.any(String),
      expiresAt: expect.any(String),
    });
    if (result.kind !== "SessionReady") {
      throw new Error("활성 Membership 확인 뒤 session이 준비되어야 합니다.");
    }
    expect(result.exchangeHandle).not.toBe("");
    const ttlMs = Date.parse(result.expiresAt) - Date.parse(serverNow);
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(WEBVIEW_SESSION_EXCHANGE_MAX_TTL_MS);
    expect(subject.state()).toMatchObject({
      sessionMirror: {
        schemaVersion: 1,
        sessionGeneration: expect.any(String),
        householdId: "household-1",
        memberId: "member-1",
      },
      issuedExchangeHandles: [result.exchangeHandle],
      membershipLookupPrincipalRefs: ["principal:user-1"],
      exposedBridgeValues: [],
    });
    expect(subject.state().sessionMirror?.sessionGeneration).not.toBe("");
    for (const sensitiveValue of [
      "principal:user-1",
      "membership-receipt-1",
      "household-1",
      "member-1",
    ]) {
      expect(result.exchangeHandle).not.toContain(sensitiveValue);
    }
  });

  it.each(["", "   "])(
    "[T-WEBVIEW-001][AND-005] 비어 있는 Native principalRef %j는 인증 성공으로 승격하지 않는다",
    async (principalRef) => {
      const subject = subjectWithLookup();

      expect(
        await subject.authenticate({ kind: "success", principalRef }),
      ).toEqual({ kind: "Failed", code: "GOOGLE_AUTH_FAILED" });
      expect(await subject.confirmMembership()).toEqual({
        kind: "Rejected",
        code: "AUTHENTICATION_REQUIRED",
      });
      expect(subject.state()).toMatchObject({
        principalRef: undefined,
        sessionMirror: undefined,
        issuedExchangeHandles: [],
        membershipLookupPrincipalRefs: [],
        exposedBridgeValues: [],
      });
    },
  );

  it.each([
    {
      status: "deleted",
      lookup: {
        kind: "Found",
        receipt: activeReceipt({ status: "deleted" }),
      } as MembershipLookupResult,
    },
    { status: "missing", lookup: { kind: "Missing" } as MembershipLookupResult },
  ])(
    "[T-WEBVIEW-001][AND-005] $status Membership 조회 결과는 Native mirror와 Web session handle을 만들지 않는다",
    async ({ lookup }) => {
      const subject = subjectWithLookup(lookup);
      await subject.authenticate({
        kind: "success",
        principalRef: "principal:user-1",
      });

      expect(await subject.confirmMembership()).toEqual({
        kind: "Rejected",
        code: "ACTIVE_MEMBERSHIP_REQUIRED",
      });
      expect(subject.state()).toMatchObject({
        sessionMirror: undefined,
        issuedExchangeHandles: [],
        exposedBridgeValues: [],
      });
    },
  );

  it("[T-WEBVIEW-001][AND-005] 인증 Principal과 다른 Principal의 Membership receipt는 active여도 거부한다", async () => {
    const subject = subjectWithLookup({
      kind: "Found",
      receipt: activeReceipt({ principalRef: "principal:other-user" }),
    });
    await subject.authenticate({
      kind: "success",
      principalRef: "principal:user-1",
    });

    expect(await subject.confirmMembership()).toEqual({
      kind: "Rejected",
      code: "MEMBERSHIP_PRINCIPAL_MISMATCH",
    });
    expect(subject.state()).toMatchObject({
      sessionMirror: undefined,
      issuedExchangeHandles: [],
      exposedBridgeValues: [],
    });
  });

  it("[T-WEBVIEW-001][AND-005] trusted Membership query가 아닌 출처의 receipt는 active 값이어도 권한 증명으로 사용하지 않는다", async () => {
    const forgedReceipt = {
      ...activeReceipt(),
      source: "untrusted-client-hint",
    } as unknown as PrincipalBoundMembershipReceipt;
    const subject = subjectWithLookup({
      kind: "Found",
      receipt: forgedReceipt,
    });
    await subject.authenticate({
      kind: "success",
      principalRef: "principal:user-1",
    });

    expect(await subject.confirmMembership()).toEqual({
      kind: "Rejected",
      code: "MEMBERSHIP_LOOKUP_FAILED",
    });
    expect(subject.state()).toMatchObject({
      sessionMirror: undefined,
      issuedExchangeHandles: [],
      exposedBridgeValues: [],
    });
  });

  it.each([
    { field: "receiptId", overrides: { receiptId: "" } },
    { field: "householdId", overrides: { householdId: "   " } },
    { field: "memberId", overrides: { memberId: "" } },
  ] as const)(
    "[T-WEBVIEW-001][AND-005] trusted 조회라도 필수 안정 식별자 $field가 비어 있으면 부분 mirror를 만들지 않는다",
    async ({ overrides }) => {
      const subject = subjectWithLookup({
        kind: "Found",
        receipt: activeReceipt(overrides),
      });
      await subject.authenticate({
        kind: "success",
        principalRef: "principal:user-1",
      });

      expect(await subject.confirmMembership()).toEqual({
        kind: "Rejected",
        code: "MEMBERSHIP_LOOKUP_FAILED",
      });
      expect(subject.state()).toMatchObject({
        sessionMirror: undefined,
        issuedExchangeHandles: [],
        exposedBridgeValues: [],
      });
    },
  );

  it("[T-WEBVIEW-001][AND-005] client의 household·member·status hint는 무시하고 서버가 조회한 Principal-bound Membership만 mirror에 쓴다", async () => {
    const subject = subjectWithLookup(
      { kind: "Found", receipt: activeReceipt() },
      {
        untrustedClientHints: {
          householdId: "household-attacker",
          memberId: "member-attacker",
          status: "deleted",
        },
      },
    );
    await subject.authenticate({
      kind: "success",
      principalRef: "principal:user-1",
    });

    expect(await subject.confirmMembership()).toMatchObject({
      kind: "SessionReady",
      principalRef: "principal:user-1",
    });
    expect(subject.state().sessionMirror).toMatchObject({
      householdId: "household-1",
      memberId: "member-1",
    });
    expect(JSON.stringify(subject.state().sessionMirror)).not.toContain(
      "attacker",
    );
  });

  it("[T-WEBVIEW-001][AND-005] Membership 조회 실패와 인증 전 확인은 handle 없는 typed 거부로 끝난다", async () => {
    const beforeAuth = subjectWithLookup();
    expect(await beforeAuth.confirmMembership()).toEqual({
      kind: "Rejected",
      code: "AUTHENTICATION_REQUIRED",
    });

    const lookupFailed = subjectWithLookup({ kind: "Failed" });
    await lookupFailed.authenticate({
      kind: "success",
      principalRef: "principal:user-1",
    });
    expect(await lookupFailed.confirmMembership()).toEqual({
      kind: "Rejected",
      code: "MEMBERSHIP_LOOKUP_FAILED",
    });
    expect(lookupFailed.state()).toMatchObject({
      sessionMirror: undefined,
      issuedExchangeHandles: [],
    });
  });

  it("[T-WEBVIEW-001][AND-005] adapter가 긴 TTL을 요청해도 일회성 handle 만료는 5분 상한을 넘지 않는다", async () => {
    const subject = subjectWithLookup(undefined, {
      requestedExchangeHandleTtlMs: 24 * 60 * 60 * 1_000,
    });
    await subject.authenticate({
      kind: "success",
      principalRef: "principal:user-1",
    });

    const result = await subject.confirmMembership();
    expect(result.kind).toBe("SessionReady");
    if (result.kind === "SessionReady") {
      expect(Date.parse(result.expiresAt) - Date.parse(serverNow)).toBe(
        WEBVIEW_SESSION_EXCHANGE_MAX_TTL_MS,
      );
    }
  });

  it("[T-WEBVIEW-001][AND-005] 5분보다 짧은 일회성 handle TTL은 서버 시각 기준으로 그대로 유지한다", async () => {
    const requestedTtlMs = 60 * 1_000;
    const subject = subjectWithLookup(undefined, {
      requestedExchangeHandleTtlMs: requestedTtlMs,
    });
    await subject.authenticate({
      kind: "success",
      principalRef: "principal:user-1",
    });

    const result = await subject.confirmMembership();
    expect(result.kind).toBe("SessionReady");
    if (result.kind === "SessionReady") {
      expect(Date.parse(result.expiresAt) - Date.parse(serverNow)).toBe(
        requestedTtlMs,
      );
    }
  });

  it.each([
    { outcome: { kind: "cancel" } as const, expected: { kind: "Cancelled" } },
    {
      outcome: { kind: "failure" } as const,
      expected: { kind: "Failed", code: "GOOGLE_AUTH_FAILED" },
    },
  ])(
    "[T-WEBVIEW-001][AND-005] Native Google 인증 $outcome.kind 시 Web OAuth·credential 노출·부분 mirror 없이 종료한다",
    async ({ outcome, expected }) => {
      const subject = subjectWithLookup();

      expect(await subject.authenticate(outcome)).toEqual(expected);
      expect(subject.state()).toEqual({
        authSurface: "android-credential-manager",
        firebaseAdapter: "android-native-sdk",
        embeddedWebOauthOpened: false,
        principalRef: undefined,
        sessionMirror: undefined,
        issuedExchangeHandles: [],
        membershipLookupPrincipalRefs: [],
        exposedBridgeValues: [],
      });
    },
  );
});
