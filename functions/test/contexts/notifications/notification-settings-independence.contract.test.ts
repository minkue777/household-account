import { describe, expect, it } from "vitest";
import type {
  AndroidRecordedTransactionUx as PublicAndroidRecordedTransactionUx,
  NotificationSettingsIndependenceInputPort,
  NotificationSettingsSnapshot as PublicNotificationSettingsSnapshot,
} from "../../../src/contexts/notifications/public";
import {
  createNotificationSettingsIndependenceFixtureSubject,
  type EndpointLifecycleMutationCall,
} from "../../support/notification-settings-independence-driver";

export type NotificationSettingsSnapshot = PublicNotificationSettingsSnapshot;

export type AndroidRecordedTransactionUx =
  PublicAndroidRecordedTransactionUx;

/** OS 표시 권한, Android QuickEdit 선호와 서버 수신 정책의 분리 계약입니다. */
export interface NotificationSettingsIndependenceContractSubject
  extends NotificationSettingsIndependenceInputPort {
  endpointLifecycleMutationCalls(): readonly EndpointLifecycleMutationCall[];
}

export function createSubject(): NotificationSettingsIndependenceContractSubject {
  return createNotificationSettingsIndependenceFixtureSubject();
}

describe("알림 OS 권한·QuickEdit·서버 Subscription 분리 계약", () => {
  it("[T-PUSH-008][PUSH-001/DEC-026] 앱에는 알림 유형별 Subscription 설정·Command가 없고 OS 권한과 Android QuickEdit만 별도 표시한다", () => {
    const subject = createSubject();

    expect(subject.visibleSettings()).toEqual(
      expect.arrayContaining([
        { id: "os-notification-permission", scope: "installation" },
        { id: "android-quick-edit", scope: "android-local" },
      ]),
    );
    expect(subject.visibleSettings()).toHaveLength(2);
    expect(subject.supportedServerCommands()).toEqual(
      expect.arrayContaining(["RegisterEndpoint", "RemoveEndpoint"]),
    );
    expect(subject.supportedServerCommands()).toHaveLength(2);
    expect(subject.supportedServerCommands()).not.toEqual(
      expect.arrayContaining([
        "CreateNotificationSubscription",
        "UpdateNotificationTypePreference",
      ]),
    );
    expect(subject.snapshot().serverSubscriptions).toEqual([]);
  });

  it("[T-PUSH-001/T-PUSH-005][PUSH-004/DEC-013/DEC-026] QuickEdit on/off는 Android 로컬 표시만 바꾸고 자동 push NoTarget 정책을 바꾸지 않는다", () => {
    const subject = createSubject();

    subject.setQuickEditEnabled(true);
    expect(subject.handleAndroidRecordedTransaction()).toEqual({
      push: { kind: "NoTarget", reason: "ANDROID_USES_QUICK_EDIT" },
      localQuickEdit: "shown",
    });

    subject.setQuickEditEnabled(false);
    expect(subject.handleAndroidRecordedTransaction()).toEqual({
      push: { kind: "NoTarget", reason: "ANDROID_USES_QUICK_EDIT" },
      localQuickEdit: "suppressed-by-preference",
    });
    expect(subject.snapshot().serverSubscriptions).toEqual([]);
  });

  it("[T-PUSH-008][PUSH-001/DEC-026] OS 권한 변경은 설치 표시 capability만 바꾸고 QuickEdit 선호나 서버 Subscription을 만들지 않는다", () => {
    const subject = createSubject();
    subject.setQuickEditEnabled(false);

    subject.setOsNotificationPermission("denied");
    expect(subject.snapshot()).toEqual({
      osNotificationPermission: "denied",
      quickEditEnabled: false,
      serverSubscriptions: [],
    });
    subject.setOsNotificationPermission("granted");
    expect(subject.snapshot()).toEqual({
      osNotificationPermission: "granted",
      quickEditEnabled: false,
      serverSubscriptions: [],
    });
  });

  it("[T-PUSH-008][PUSH-001/PUSH-003/DEC-026] OS 권한과 QuickEdit 선호 변경만으로 endpoint lifecycle Command를 실행하지 않는다", () => {
    const subject = createSubject();

    subject.setOsNotificationPermission("denied");
    subject.setQuickEditEnabled(false);
    subject.setOsNotificationPermission("granted");

    expect(subject.endpointLifecycleMutationCalls()).toEqual([]);
    expect(subject.supportedServerCommands()).toEqual([
      "RegisterEndpoint",
      "RemoveEndpoint",
    ]);
  });
});
