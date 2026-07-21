import { describe, expect, it } from "vitest";
import {
  createHostAccessFixtureSubject,
  type HostAccessFixtureSubject,
  type HostAccessPermissionState,
} from "../../../support/host-access-fixture";

export interface AndroidHostAccessContractSubject
  extends HostAccessFixtureSubject {}

export function createSubject(): AndroidHostAccessContractSubject {
  return createHostAccessFixtureSubject();
}

const target = {
  packageName: "com.household.account",
  className: "com.household.account.service.CardNotificationListenerService",
};

function state(
  overrides: Partial<HostAccessPermissionState> = {},
): HostAccessPermissionState {
  return {
    notificationListenerComponent: target,
    enabledNotificationListenerComponents: [target],
    canDrawOverlays: true,
    quickEditEnabled: true,
    ...overrides,
  };
}

describe("Android Host 필수 권한 gate 공개 계약", () => {
  it("[T-ANDROID-HOST-001][AND-001/AND-002] 정확한 알림 listener component와 overlay 권한이 모두 있으면 Web Shell을 표시한다", () => {
    expect(createSubject().decide(state())).toEqual({ kind: "ShowWebShell" });
  });

  it.each([
    {
      name: "package 이름만 포함하는 다른 component",
      enabled: [
        {
          packageName: "com.household.account.fake",
          className:
            "com.household.account.fake.CardNotificationListenerService",
        },
      ],
    },
    {
      name: "class 이름만 포함하는 다른 component",
      enabled: [
        {
          packageName: "com.household.account",
          className:
            "com.household.account.service.CardNotificationListenerServiceBackup",
        },
      ],
    },
  ])(
    "[T-ANDROID-HOST-001][AND-002] $name는 알림 접근 허용으로 오인하지 않는다",
    ({ enabled }) => {
      expect(
        createSubject().decide(
          state({ enabledNotificationListenerComponents: enabled }),
        ),
      ).toEqual({
        kind: "ShowPermissionGuide",
        notificationAccess: "missing",
        overlay: "granted",
        actions: ["OPEN_NOTIFICATION_LISTENER_SETTINGS"],
      });
    },
  );

  it("[T-ANDROID-HOST-001][AND-001/AND-002] 두 필수 권한이 없으면 각각의 시스템 설정 action을 제공한다", () => {
    expect(
      createSubject().decide(
        state({
          enabledNotificationListenerComponents: [],
          canDrawOverlays: false,
        }),
      ),
    ).toEqual({
      kind: "ShowPermissionGuide",
      notificationAccess: "missing",
      overlay: "missing",
      actions: [
        "OPEN_NOTIFICATION_LISTENER_SETTINGS",
        "OPEN_OVERLAY_SETTINGS",
      ],
    });
  });

  it("[T-ANDROID-HOST-001][AND-001] 진입 후 QuickEdit 설정을 꺼도 최초 overlay 필수 gate를 우회하지 않는다", () => {
    expect(
      createSubject().decide(
        state({ canDrawOverlays: false, quickEditEnabled: false }),
      ),
    ).toEqual({
      kind: "ShowPermissionGuide",
      notificationAccess: "granted",
      overlay: "missing",
      actions: ["OPEN_OVERLAY_SETTINGS"],
    });
  });

  it("[T-ANDROID-HOST-001][AND-001/DEC-004] 두 필수 권한을 받은 뒤 QuickEdit을 꺼도 Web Shell 진입은 유지한다", () => {
    expect(createSubject().decide(state({ quickEditEnabled: false }))).toEqual({
      kind: "ShowWebShell",
    });
  });

  it("[T-ANDROID-HOST-001][AND-001/DEC-004] QuickEdit을 꺼도 알림 접근 필수 gate는 우회하지 않는다", () => {
    expect(
      createSubject().decide(
        state({
          enabledNotificationListenerComponents: [],
          quickEditEnabled: false,
        }),
      ),
    ).toEqual({
      kind: "ShowPermissionGuide",
      notificationAccess: "missing",
      overlay: "granted",
      actions: ["OPEN_NOTIFICATION_LISTENER_SETTINGS"],
    });
  });

  it("[T-ANDROID-HOST-001][AND-002] 다른 listener가 함께 활성화되어 있어도 정확한 대상 component가 하나 있으면 허용한다", () => {
    expect(
      createSubject().decide(
        state({
          enabledNotificationListenerComponents: [
            {
              packageName: "com.example.unrelated",
              className: "com.example.unrelated.Listener",
            },
            target,
          ],
        }),
      ),
    ).toEqual({ kind: "ShowWebShell" });
  });
});
