import { describe, expect, it } from "vitest";

import { createNotificationPermissionFixture } from "../../../support/notification-permission-fixture";

export interface AndroidCapabilityState {
  webShellAvailable: boolean;
  notificationCaptureAvailable: boolean;
  quickEditAvailable: boolean;
  fidRegistrationAvailable: boolean;
  notificationDisplay: "granted" | "denied" | "not-required" | "unknown";
  nextPermissionAction: "request-dialog" | "settings-only" | "none";
}

export type NotificationPermissionResult =
  | { kind: "NotRequired" }
  | { kind: "Granted"; dialogShown: boolean }
  | { kind: "Denied"; dialogShown: boolean; repeatDialogAllowed: boolean }
  | { kind: "DeferredUntilUserAction" }
  | { kind: "SettingsOnly" };

export interface AndroidNotificationPermissionContractSubject {
  request(input: {
    apiLevel: number;
    userInitiated: boolean;
    osOutcome?: "granted" | "denied";
  }): NotificationPermissionResult;
  state(): AndroidCapabilityState;
}

export function createSubject(fixture?: {
  previouslyDenied?: boolean;
  canAskAgain?: boolean;
}): AndroidNotificationPermissionContractSubject {
  return createNotificationPermissionFixture(fixture);
}

describe("Android 알림 표시 권한 독립 capability 공개 계약", () => {
  it("[T-ANDROID-NOTIFICATION-PERMISSION-001][AND-010] API 32 이하는 runtime 권한 dialog를 요청하지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.request({ apiLevel: 32, userInitiated: true, osOutcome: "denied" }),
    ).toEqual({ kind: "NotRequired" });
    expect(subject.state()).toEqual({
      webShellAvailable: true,
      notificationCaptureAvailable: true,
      quickEditAvailable: true,
      fidRegistrationAvailable: true,
      notificationDisplay: "not-required",
      nextPermissionAction: "none",
    });
  });

  it.each(["granted", "denied"] as const)(
    "[T-ANDROID-NOTIFICATION-PERMISSION-001][AND-010] API 33은 사용자 action에서만 dialog를 열고 $outcome 상태를 별도 기록한다",
    (outcome) => {
      const subject = createSubject();

      const result = subject.request({
        apiLevel: 33,
        userInitiated: true,
        osOutcome: outcome,
      });

      expect(result).toMatchObject({
        kind: outcome === "granted" ? "Granted" : "Denied",
        dialogShown: true,
      });
      expect(subject.state()).toMatchObject({
        notificationDisplay: outcome,
        webShellAvailable: true,
        notificationCaptureAvailable: true,
        quickEditAvailable: true,
        fidRegistrationAvailable: true,
      });
    },
  );

  it("[T-ANDROID-NOTIFICATION-PERMISSION-001][AND-010] 표시 권한 거부는 WebView·결제 수집·QuickEdit·FID 등록을 막지 않는다", () => {
    const subject = createSubject();
    subject.request({ apiLevel: 33, userInitiated: true, osOutcome: "denied" });

    expect(subject.state()).toEqual({
      webShellAvailable: true,
      notificationCaptureAvailable: true,
      quickEditAvailable: true,
      fidRegistrationAvailable: true,
      notificationDisplay: "denied",
      nextPermissionAction: "settings-only",
    });
  });

  it("[T-ANDROID-NOTIFICATION-PERMISSION-001][AND-010] 거부했고 재요청할 수 없는 사용자는 dialog를 반복하지 않고 설정 action만 제공한다", () => {
    const subject = createSubject({ previouslyDenied: true, canAskAgain: false });

    expect(
      subject.request({ apiLevel: 33, userInitiated: true, osOutcome: "granted" }),
    ).toEqual({ kind: "SettingsOnly" });
    expect(subject.state()).toMatchObject({
      notificationDisplay: "denied",
      nextPermissionAction: "settings-only",
      webShellAvailable: true,
      notificationCaptureAvailable: true,
    });
  });

  it("[T-ANDROID-NOTIFICATION-PERMISSION-001][AND-010] 사용자 action이 아닌 lifecycle 진입에서는 API 33 dialog를 자동 실행하지 않는다", () => {
    const subject = createSubject();

    expect(subject.request({ apiLevel: 33, userInitiated: false })).toEqual({
      kind: "DeferredUntilUserAction",
    });
    expect(subject.state()).toMatchObject({
      notificationDisplay: "unknown",
      nextPermissionAction: "request-dialog",
    });
  });

  it("[T-ANDROID-NOTIFICATION-PERMISSION-001][AND-010] API 34도 API 33과 같은 사용자 action 경계를 적용한다", () => {
    const subject = createSubject();

    expect(
      subject.request({ apiLevel: 34, userInitiated: true, osOutcome: "granted" }),
    ).toEqual({ kind: "Granted", dialogShown: true });
    expect(subject.state().notificationDisplay).toBe("granted");
  });

  it("[T-ANDROID-NOTIFICATION-PERMISSION-001][AND-010] OS가 재요청을 허용한 거부 상태만 dialog 재요청 action을 유지한다", () => {
    const subject = createSubject({ previouslyDenied: true, canAskAgain: true });

    expect(
      subject.request({ apiLevel: 33, userInitiated: true, osOutcome: "denied" }),
    ).toEqual({
      kind: "Denied",
      dialogShown: true,
      repeatDialogAllowed: true,
    });
    expect(subject.state()).toMatchObject({
      notificationDisplay: "denied",
      nextPermissionAction: "request-dialog",
    });
  });
});
