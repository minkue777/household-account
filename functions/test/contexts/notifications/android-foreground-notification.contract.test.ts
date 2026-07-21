import { describe, expect, it } from "vitest";
import type {
  AndroidForegroundNotificationInputPort,
  AndroidForegroundPayload as PublicAndroidForegroundPayload,
  AndroidForegroundResult as PublicAndroidForegroundResult,
} from "../../../src/contexts/notifications/public";
import {
  createAndroidForegroundNotificationFixtureSubject,
  type AndroidForegroundSnapshot as FixtureAndroidForegroundSnapshot,
} from "../../support/foreground-notification-driver";

export type AndroidForegroundPayload = PublicAndroidForegroundPayload;

export type AndroidForegroundResult =
  PublicAndroidForegroundResult;

export type AndroidForegroundSnapshot = FixtureAndroidForegroundSnapshot;

/** Android foreground payload 소비 Adapter의 공개 효과 계약입니다. */
export interface AndroidForegroundNotificationSubject
  extends AndroidForegroundNotificationInputPort {
  snapshot(): Promise<AndroidForegroundSnapshot>;
}

export function createSubject(): AndroidForegroundNotificationSubject {
  return createAndroidForegroundNotificationFixtureSubject();
}

const notificationPayload: AndroidForegroundPayload = {
  payloadVersion: "notification-payload.v1",
  notification: {
    title: "지출 등록",
    body: "카드 지출이 등록되었습니다.",
  },
  data: {
    clickTarget: "expense-edit",
    expenseId: "expense-1",
  },
};

describe("Android foreground 알림 표시 공개 계약", () => {
  it.each([
    {
      androidApiLevel: 32,
      permission: "not-required" as const,
    },
    {
      androidApiLevel: 33,
      permission: "granted" as const,
    },
  ])(
    "[T-PUSH-009][PUSH-007] Android API $androidApiLevel의 허용된 notification payload는 지정 채널로 표시하고 MainActivity를 연다",
    async ({ androidApiLevel, permission }) => {
      const subject = createSubject();

      const result = await subject.receive({
        androidApiLevel,
        postNotificationsPermission: permission,
        payload: notificationPayload,
      });

      expect(result).toEqual({
        kind: "displayed",
        notificationId: expect.any(Number),
        channel: {
          id: "expense_notifications",
          name: "지출 알림",
          importance: "default",
        },
        contentIntent: { activity: "MainActivity" },
      });
      if (result.kind !== "displayed") {
        throw new Error("Android foreground 알림이 표시되지 않았습니다.");
      }
      expect(await subject.snapshot()).toEqual({
        displayedNotifications: [
          {
            notificationId: result.notificationId,
            title: "지출 등록",
            body: "카드 지출이 등록되었습니다.",
            channelId: "expense_notifications",
            contentActivity: "MainActivity",
          },
        ],
      });
    },
  );

  it("[T-PUSH-009][PUSH-007] data-only payload는 foreground 시스템 알림으로 표시하지 않는다", async () => {
    const subject = createSubject();

    const result = await subject.receive({
      androidApiLevel: 33,
      postNotificationsPermission: "granted",
      payload: {
        payloadVersion: "notification-payload.v1",
        data: { expenseId: "expense-1" },
      },
    });

    expect(result).toEqual({
      kind: "not-displayed",
      reason: "DATA_ONLY_PAYLOAD",
    });
    expect(await subject.snapshot()).toEqual({ displayedNotifications: [] });
  });

  it("[T-PUSH-009][PUSH-007] Android 13 이상에서 POST_NOTIFICATIONS 거부 상태를 표시 성공으로 위장하지 않는다", async () => {
    const subject = createSubject();

    const result = await subject.receive({
      androidApiLevel: 33,
      postNotificationsPermission: "denied",
      payload: notificationPayload,
    });

    expect(result).toEqual({
      kind: "not-displayed",
      reason: "POST_NOTIFICATIONS_PERMISSION_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual({ displayedNotifications: [] });
  });

  it("[T-PUSH-009][PUSH-007] 알 수 없는 future payload version은 표시하지 않고 계약 경계에서 종료한다", async () => {
    const subject = createSubject();

    const result = await subject.receive({
      androidApiLevel: 33,
      postNotificationsPermission: "granted",
      payload: {
        ...notificationPayload,
        payloadVersion: "notification-payload.v999",
      },
    });

    expect(result).toEqual({
      kind: "not-displayed",
      reason: "UNSUPPORTED_PAYLOAD_VERSION",
    });
    expect(await subject.snapshot()).toEqual({ displayedNotifications: [] });
  });
});
