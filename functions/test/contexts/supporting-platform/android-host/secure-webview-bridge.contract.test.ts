import { describe, expect, it } from "vitest";

import { createSecureWebViewBridgeFixture } from "../../../support/secure-webview-bridge-fixture";

export type SensitiveBridgeOperation =
  | "SYNC_SESSION_MIRROR"
  | "CLEAR_HOUSEHOLD_MIRROR"
  | "GET_QUICK_EDIT_PREFERENCE"
  | "SET_QUICK_EDIT_PREFERENCE"
  | "GET_APP_VERSION";

export type BridgeResult =
  | { kind: "Success"; requestId: string }
  | {
      kind: "Rejected";
      requestId: string;
      code:
        | "ORIGIN_NOT_ALLOWED"
        | "TOP_LEVEL_REQUIRED"
        | "VERSION_UNSUPPORTED"
        | "MEMBERSHIP_RECEIPT_REQUIRED"
        | "MEMBERSHIP_RECEIPT_INVALID"
        | "MEMBERSHIP_RECEIPT_ALREADY_USED";
    };

export type WebViewSessionExchangeResult =
  | { kind: "SessionEstablished"; principalRef: string }
  | {
      kind: "Rejected";
      code: "ORIGIN_NOT_ALLOWED" | "EXPIRED" | "ALREADY_USED";
    };

export interface SecureWebViewBridgeState {
  acceptedSensitiveOperations: readonly SensitiveBridgeOperation[];
  sessionMirror?: {
    principalRef: string;
    householdId: string;
    memberId: string;
  };
  establishedPrincipalRefs: readonly string[];
  exposedCredentialValues: readonly string[];
}

export interface SecureWebViewBridgeContractSubject {
  execute(input: {
    requestId: string;
    contractVersion: "v1" | "unknown";
    topLevelDocumentUrl: string;
    frame: "top-level" | "subframe";
    operation: SensitiveBridgeOperation;
    membershipReceiptId?: string;
    at?: string;
  }): BridgeResult;
  exchangeSession(input: {
    topLevelDocumentUrl: string;
    handle: string;
    at: string;
  }): WebViewSessionExchangeResult;
  state(): SecureWebViewBridgeState;
}

export function createSubject(fixture: {
  allowedOrigins: readonly string[];
  exchangeHandles?: readonly {
    handle: string;
    principalRef: string;
    expiresAt: string;
  }[];
  membershipReceipts?: readonly {
    receiptId: string;
    principalRef: string;
    householdId: string;
    memberId: string;
    expiresAt: string;
  }[];
}): SecureWebViewBridgeContractSubject {
  return createSecureWebViewBridgeFixture(fixture);
}

const allowedOrigin = "https://household.example:443";

describe("Android WebView Bridge origin·일회성 session 공개 계약", () => {
  it("[T-WEBVIEW-001][AND-006/AND-007] 허용 origin의 top-level v1 요청만 앱 버전 operation을 실행한다", () => {
    const subject = createSubject({ allowedOrigins: [allowedOrigin] });

    expect(
      subject.execute({
        requestId: "request-1",
        contractVersion: "v1",
        topLevelDocumentUrl: `${allowedOrigin}/settings?tab=cards`,
        frame: "top-level",
        operation: "GET_APP_VERSION",
      }),
    ).toEqual({ kind: "Success", requestId: "request-1" });
    expect(subject.state()).toEqual({
      acceptedSensitiveOperations: ["GET_APP_VERSION"],
      sessionMirror: undefined,
      establishedPrincipalRefs: [],
      exposedCredentialValues: [],
    });
  });

  it("[T-WEBVIEW-001][AND-005/AND-006] 허용 origin이어도 서버 Membership receipt 없이는 SessionMirror를 동기화하지 않는다", () => {
    const subject = createSubject({ allowedOrigins: [allowedOrigin] });

    expect(
      subject.execute({
        requestId: "mirror-without-receipt",
        contractVersion: "v1",
        topLevelDocumentUrl: `${allowedOrigin}/app`,
        frame: "top-level",
        operation: "SYNC_SESSION_MIRROR",
        at: "2026-07-20T10:00:00+09:00",
      }),
    ).toEqual({
      kind: "Rejected",
      requestId: "mirror-without-receipt",
      code: "MEMBERSHIP_RECEIPT_REQUIRED",
    });
    expect(subject.state()).toMatchObject({
      acceptedSensitiveOperations: [],
      sessionMirror: undefined,
      exposedCredentialValues: [],
    });
  });

  it("[T-WEBVIEW-001][AND-005/AND-006] 알려지지 않은 receipt ID나 client가 만든 household·member 값은 mirror 권한 증명이 아니다", () => {
    const subject = createSubject({ allowedOrigins: [allowedOrigin] });

    expect(
      subject.execute({
        requestId: "mirror-forged-receipt",
        contractVersion: "v1",
        topLevelDocumentUrl: `${allowedOrigin}/app?householdId=household-attacker&memberId=member-attacker`,
        frame: "top-level",
        operation: "SYNC_SESSION_MIRROR",
        membershipReceiptId: "client-forged-receipt",
        at: "2026-07-20T10:00:00+09:00",
      }),
    ).toEqual({
      kind: "Rejected",
      requestId: "mirror-forged-receipt",
      code: "MEMBERSHIP_RECEIPT_INVALID",
    });
    expect(subject.state().sessionMirror).toBeUndefined();
  });

  it("[T-WEBVIEW-001][AND-005/AND-006] 서버가 발급한 Principal-bound Membership receipt의 ID만 authoritative mirror로 소비한다", () => {
    const subject = createSubject({
      allowedOrigins: [allowedOrigin],
      membershipReceipts: [
        {
          receiptId: "membership-receipt-1",
          principalRef: "principal:user-1",
          householdId: "household-1",
          memberId: "member-1",
          expiresAt: "2026-07-20T10:05:00+09:00",
        },
      ],
    });
    const request = {
      requestId: "mirror-authorized",
      contractVersion: "v1" as const,
      topLevelDocumentUrl: `${allowedOrigin}/app`,
      frame: "top-level" as const,
      operation: "SYNC_SESSION_MIRROR" as const,
      membershipReceiptId: "membership-receipt-1",
      at: "2026-07-20T10:04:59+09:00",
    };

    expect(subject.execute(request)).toEqual({
      kind: "Success",
      requestId: "mirror-authorized",
    });
    expect(subject.state()).toMatchObject({
      acceptedSensitiveOperations: ["SYNC_SESSION_MIRROR"],
      sessionMirror: {
        principalRef: "principal:user-1",
        householdId: "household-1",
        memberId: "member-1",
      },
      exposedCredentialValues: [],
    });
    expect(
      subject.execute({ ...request, requestId: "mirror-replayed" }),
    ).toEqual({
      kind: "Rejected",
      requestId: "mirror-replayed",
      code: "MEMBERSHIP_RECEIPT_ALREADY_USED",
    });
  });

  it("[T-WEBVIEW-001][AND-006] 지원하지 않는 Bridge version은 허용 origin에서도 operation을 실행하지 않는다", () => {
    const subject = createSubject({ allowedOrigins: [allowedOrigin] });

    expect(
      subject.execute({
        requestId: "unsupported-version",
        contractVersion: "unknown",
        topLevelDocumentUrl: `${allowedOrigin}/app`,
        frame: "top-level",
        operation: "GET_APP_VERSION",
      }),
    ).toEqual({
      kind: "Rejected",
      requestId: "unsupported-version",
      code: "VERSION_UNSUPPORTED",
    });
    expect(subject.state().acceptedSensitiveOperations).toEqual([]);
  });

  it.each([
    { name: "유사 hostname", url: "https://household.example.evil:443", frame: "top-level" },
    { name: "다른 scheme", url: "http://household.example:443", frame: "top-level" },
    { name: "다른 port", url: "https://household.example:444", frame: "top-level" },
    { name: "redirect 뒤 외부 origin", url: "https://evil.example/redirected", frame: "top-level" },
  ] as const)(
    "[T-WEBVIEW-001][AND-006] $name 문서에는 민감 API를 노출하지 않는다",
    ({ url, frame }) => {
      const subject = createSubject({ allowedOrigins: [allowedOrigin] });

      expect(
        subject.execute({
          requestId: "request-2",
          contractVersion: "v1",
          topLevelDocumentUrl: url,
          frame,
          operation: "CLEAR_HOUSEHOLD_MIRROR",
        }),
      ).toEqual({
        kind: "Rejected",
        requestId: "request-2",
        code: "ORIGIN_NOT_ALLOWED",
      });
      expect(subject.state().acceptedSensitiveOperations).toEqual([]);
    },
  );

  it("[T-WEBVIEW-001][AND-006] 허용 origin 안의 subframe도 Bridge를 호출할 수 없다", () => {
    const subject = createSubject({ allowedOrigins: [allowedOrigin] });

    expect(
      subject.execute({
        requestId: "request-3",
        contractVersion: "v1",
        topLevelDocumentUrl: `${allowedOrigin}/embedded`,
        frame: "subframe",
        operation: "GET_QUICK_EDIT_PREFERENCE",
      }),
    ).toEqual({
      kind: "Rejected",
      requestId: "request-3",
      code: "TOP_LEVEL_REQUIRED",
    });
    expect(subject.state().acceptedSensitiveOperations).toEqual([]);
  });

  it("[T-WEBVIEW-001][AND-005] 일회성 handle은 허용 origin에서 한 번만 같은 Principal session으로 교환한다", () => {
    const subject = createSubject({
      allowedOrigins: [allowedOrigin],
      exchangeHandles: [
        {
          handle: "one-time-handle",
          principalRef: "principal:user-1",
          expiresAt: "2026-07-20T10:05:00+09:00",
        },
      ],
    });

    expect(
      subject.exchangeSession({
        topLevelDocumentUrl: `${allowedOrigin}/login/callback`,
        handle: "one-time-handle",
        at: "2026-07-20T10:04:59+09:00",
      }),
    ).toEqual({
      kind: "SessionEstablished",
      principalRef: "principal:user-1",
    });
    expect(
      subject.exchangeSession({
        topLevelDocumentUrl: `${allowedOrigin}/login/callback`,
        handle: "one-time-handle",
        at: "2026-07-20T10:05:00+09:00",
      }),
    ).toEqual({ kind: "Rejected", code: "ALREADY_USED" });
    expect(subject.state()).toEqual({
      acceptedSensitiveOperations: [],
      sessionMirror: undefined,
      establishedPrincipalRefs: ["principal:user-1"],
      exposedCredentialValues: [],
    });
  });

  it("[T-WEBVIEW-001][AND-005] 사용하지 않은 handle도 expiresAt 경계 시각부터 만료로 거부한다", () => {
    const subject = createSubject({
      allowedOrigins: [allowedOrigin],
      exchangeHandles: [
        {
          handle: "boundary-handle",
          principalRef: "principal:user-1",
          expiresAt: "2026-07-20T10:05:00+09:00",
        },
      ],
    });

    expect(
      subject.exchangeSession({
        topLevelDocumentUrl: `${allowedOrigin}/login/callback`,
        handle: "boundary-handle",
        at: "2026-07-20T10:05:00+09:00",
      }),
    ).toEqual({ kind: "Rejected", code: "EXPIRED" });
    expect(subject.state()).toMatchObject({
      establishedPrincipalRefs: [],
      sessionMirror: undefined,
      exposedCredentialValues: [],
    });
  });

  it("[T-WEBVIEW-001][AND-005/AND-006] 만료 handle이나 다른 origin 요청은 session과 credential 노출 없이 거부한다", () => {
    const fixture = {
      allowedOrigins: [allowedOrigin],
      exchangeHandles: [
        {
          handle: "expired-handle",
          principalRef: "principal:user-1",
          expiresAt: "2026-07-20T10:05:00+09:00",
        },
      ],
    };
    const expiredSubject = createSubject(fixture);
    const wrongOriginSubject = createSubject(fixture);

    expect(
      expiredSubject.exchangeSession({
        topLevelDocumentUrl: `${allowedOrigin}/login/callback`,
        handle: "expired-handle",
        at: "2026-07-20T10:05:01+09:00",
      }),
    ).toEqual({ kind: "Rejected", code: "EXPIRED" });
    expect(
      wrongOriginSubject.exchangeSession({
        topLevelDocumentUrl: "https://evil.example/login/callback",
        handle: "expired-handle",
        at: "2026-07-20T10:04:00+09:00",
      }),
    ).toEqual({ kind: "Rejected", code: "ORIGIN_NOT_ALLOWED" });
    expect(expiredSubject.state().establishedPrincipalRefs).toEqual([]);
    expect(wrongOriginSubject.state().exposedCredentialValues).toEqual([]);
  });

  it.each([
    "CLEAR_HOUSEHOLD_MIRROR",
    "GET_QUICK_EDIT_PREFERENCE",
    "SET_QUICK_EDIT_PREFERENCE",
  ] as const)("허용된 top-level v1의 %s operation을 공개 목록대로 실행한다", (operation) => {
    const subject = createSubject({ allowedOrigins: [allowedOrigin] });

    expect(
      subject.execute({
        requestId: `request-${operation}`,
        contractVersion: "v1",
        topLevelDocumentUrl: `${allowedOrigin}/app`,
        frame: "top-level",
        operation,
      }),
    ).toEqual({ kind: "Success", requestId: `request-${operation}` });
    expect(subject.state().acceptedSensitiveOperations).toEqual([operation]);
  });

  it("Membership receipt도 expiresAt 경계부터 소비하지 않는다", () => {
    const subject = createSubject({
      allowedOrigins: [allowedOrigin],
      membershipReceipts: [
        {
          receiptId: "membership-boundary",
          principalRef: "principal:user-1",
          householdId: "household-1",
          memberId: "member-1",
          expiresAt: "2026-07-20T10:05:00+09:00",
        },
      ],
    });

    expect(
      subject.execute({
        requestId: "receipt-at-boundary",
        contractVersion: "v1",
        topLevelDocumentUrl: `${allowedOrigin}/app`,
        frame: "top-level",
        operation: "SYNC_SESSION_MIRROR",
        membershipReceiptId: "membership-boundary",
        at: "2026-07-20T10:05:00+09:00",
      }),
    ).toEqual({
      kind: "Rejected",
      requestId: "receipt-at-boundary",
      code: "MEMBERSHIP_RECEIPT_INVALID",
    });
    expect(subject.state().sessionMirror).toBeUndefined();
  });
});
