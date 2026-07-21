import { describe, expect, it } from "vitest";

import { createQuickEditOverlayPolicyFixture } from "../../../support/quick-edit-overlay-policy-fixture";

export type QuickEditOverlayDecision =
  | {
      kind: "Presented";
      presentation: {
        turnScreenOn: true;
        showAboveLockScreen: true;
        keyguard: "preserved";
        activityExport: "non-exported";
        screenshot: "allowed";
        screenRecording: "allowed";
        recentAppsPreview: "allowed";
      };
    }
  | {
      kind: "Suppressed";
      reason:
        | "USER_DISABLED"
        | "INVALID_TRANSACTION"
        | "NO_ACTIVE_SESSION"
        | "EXTERNAL_ENTRY_REJECTED";
    };

export interface QuickEditOverlayPolicySubject {
  decide(input: {
    quickEditEnabled: boolean;
    activeSession: boolean;
    transactionId?: string;
    entrySource: "internal-capture" | "external-intent";
    deviceLocked: boolean;
  }): QuickEditOverlayDecision;
}

export function createSubject(): QuickEditOverlayPolicySubject {
  return createQuickEditOverlayPolicyFixture();
}

describe("QuickEdit 잠금 화면 표시 공개 계약", () => {
  it("[T-QE-005][QE-008/QE-011][DEC-024/DEC-045] 내부 유효 거래는 잠금 위에 표시하되 keyguard를 유지하고 화면 캡처·최근 앱 미리보기를 허용한다", () => {
    const result = createSubject().decide({
      quickEditEnabled: true,
      activeSession: true,
      transactionId: "transaction-1",
      entrySource: "internal-capture",
      deviceLocked: true,
    });

    expect(result).toEqual({
      kind: "Presented",
      presentation: {
        turnScreenOn: true,
        showAboveLockScreen: true,
        keyguard: "preserved",
        activityExport: "non-exported",
        screenshot: "allowed",
        screenRecording: "allowed",
        recentAppsPreview: "allowed",
      },
    });
  });

  it("[T-QE-005][QE-008] QuickEdit 설정이 꺼져 있으면 잠금 화면 표시와 화면 켜기를 시작하지 않는다", () => {
    const result = createSubject().decide({
      quickEditEnabled: false,
      activeSession: true,
      transactionId: "transaction-1",
      entrySource: "internal-capture",
      deviceLocked: true,
    });

    expect(result).toEqual({ kind: "Suppressed", reason: "USER_DISABLED" });
  });

  it("[T-QE-005][QE-008] transaction ID가 없거나 현재 session이 없으면 민감 편집 화면을 표시하지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.decide({
        quickEditEnabled: true,
        activeSession: true,
        transactionId: undefined,
        entrySource: "internal-capture",
        deviceLocked: true,
      }),
    ).toEqual({ kind: "Suppressed", reason: "INVALID_TRANSACTION" });
    expect(
      subject.decide({
        quickEditEnabled: true,
        activeSession: false,
        transactionId: "transaction-1",
        entrySource: "internal-capture",
        deviceLocked: true,
      }),
    ).toEqual({ kind: "Suppressed", reason: "NO_ACTIVE_SESSION" });
  });

  it("[T-QE-005][QE-008/QE-011] 외부 Intent로는 잠금 화면 QuickEdit에 진입할 수 없다", () => {
    const result = createSubject().decide({
      quickEditEnabled: true,
      activeSession: true,
      transactionId: "transaction-1",
      entrySource: "external-intent",
      deviceLocked: true,
    });

    expect(result).toEqual({
      kind: "Suppressed",
      reason: "EXTERNAL_ENTRY_REJECTED",
    });
  });

  it("[T-QE-005][QE-008] 공백 transaction ID도 유효 거래로 해석하지 않는다", () => {
    expect(
      createSubject().decide({
        quickEditEnabled: true,
        activeSession: true,
        transactionId: "   ",
        entrySource: "internal-capture",
        deviceLocked: false,
      }),
    ).toEqual({ kind: "Suppressed", reason: "INVALID_TRANSACTION" });
  });

  it("[T-QE-005][QE-008/QE-011] 기기가 잠기지 않았어도 같은 비공개 Activity 정책으로 표시한다", () => {
    expect(
      createSubject().decide({
        quickEditEnabled: true,
        activeSession: true,
        transactionId: "transaction-1",
        entrySource: "internal-capture",
        deviceLocked: false,
      }),
    ).toMatchObject({
      kind: "Presented",
      presentation: { activityExport: "non-exported", keyguard: "preserved" },
    });
  });
});
