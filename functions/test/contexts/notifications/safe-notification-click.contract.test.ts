import { describe, expect, it } from "vitest";
import type {
  NotificationClickInput as PublicNotificationClickInput,
  NotificationClickResult as PublicNotificationClickResult,
  NotificationClientView as PublicNotificationClientView,
  SafeNotificationClickInputPort,
} from "../../../src/contexts/notifications/public";
import {
  createSafeNotificationClickFixtureSubject,
  type NotificationNavigationSnapshot as FixtureNotificationNavigationSnapshot,
} from "../../support/safe-notification-click-driver";

export type NotificationClientView = PublicNotificationClientView;

export type NotificationClickInput = PublicNotificationClickInput;

export type NotificationClickResult =
  PublicNotificationClickResult;

export type NotificationNavigationSnapshot =
  FixtureNotificationNavigationSnapshot;

/**
 * PWA worker의 클릭 Adapter 공개 경계입니다.
 * browser API 호출 횟수 대신 최종 focus/open 효과만 관찰합니다.
 */
export interface SafeNotificationClickSubject
  extends SafeNotificationClickInputPort {
  snapshot(): Promise<NotificationNavigationSnapshot>;
}

export function createSubject(): SafeNotificationClickSubject {
  return createSafeNotificationClickFixtureSubject();
}

const origin = "https://household.example";

const validExpensePayload = (
  expenseId = "expense_A-1.2",
): Readonly<Record<string, unknown>> => ({
  payloadVersion: "notification-payload.v1",
  type: "expense-created",
  clickTarget: "expense-edit",
  expenseId,
});

describe("PWA 알림 클릭의 same-origin 탐색 공개 계약", () => {
  it("[T-PUSH-SEC-002][PUSH-006/PUSH-011] 유효한 expense payload는 같은 origin 기존 창만 편집 URL로 focus한다", async () => {
    const subject = createSubject();

    const result = await subject.handleNotificationClick({
      action: "default",
      applicationOrigin: origin,
      payload: validExpensePayload(),
      clients: [
        {
          clientId: "external-client",
          url: "https://evil.example/already-open",
          visibilityState: "visible",
        },
        {
          clientId: "application-client",
          url: `${origin}/stats`,
          visibilityState: "hidden",
        },
      ],
    });

    expect(result).toEqual({
      kind: "focused",
      clientId: "application-client",
      url: `${origin}/?edit=expense_A-1.2`,
    });
    expect(await subject.snapshot()).toEqual({
      focusedClients: [
        {
          clientId: "application-client",
          url: `${origin}/?edit=expense_A-1.2`,
        },
      ],
      openedUrls: [],
      externalNavigationUrls: [],
    });
  });

  it("[T-PUSH-SEC-002][PUSH-006/PUSH-011] 같은 origin 창이 없으면 서버 enum으로 만든 상대 편집 URL만 새로 연다", async () => {
    const subject = createSubject();

    const result = await subject.handleNotificationClick({
      action: "default",
      applicationOrigin: origin,
      payload: validExpensePayload("expense-encoded_01"),
      clients: [
        {
          clientId: "external-client",
          url: "https://evil.example/household",
          visibilityState: "visible",
        },
      ],
    });

    expect(result).toEqual({
      kind: "opened",
      url: `${origin}/?edit=expense-encoded_01`,
    });
    expect(await subject.snapshot()).toEqual({
      focusedClients: [],
      openedUrls: [`${origin}/?edit=expense-encoded_01`],
      externalNavigationUrls: [],
    });
  });

  it.each([
    { url: "https://evil.example/takeover" },
    { url: "javascript:alert(1)" },
    { host: "evil.example", path: "/takeover" },
  ])(
    "[T-PUSH-SEC-002][PUSH-011] payload의 URL·scheme·host·path 입력 $url$host는 탐색 자료로 사용하지 않는다",
    async (maliciousFields) => {
      const subject = createSubject();

      const result = await subject.handleNotificationClick({
        action: "default",
        applicationOrigin: origin,
        payload: {
          ...validExpensePayload(),
          ...maliciousFields,
        },
        clients: [],
      });

      expect(result).toEqual({
        kind: "no-navigation",
        reason: "INVALID_PAYLOAD",
      });
      expect(await subject.snapshot()).toEqual({
        focusedClients: [],
        openedUrls: [],
        externalNavigationUrls: [],
      });
    },
  );

  it.each([
    "expense/../../admin",
    "expense?redirect=https://evil.example",
    "expense with spaces",
    "x".repeat(4096),
  ])(
    "[T-PUSH-SEC-002][PUSH-011] 잘못되거나 과대한 expenseId %s는 URL에 넣지 않는다",
    async (expenseId) => {
      const subject = createSubject();

      const result = await subject.handleNotificationClick({
        action: "default",
        applicationOrigin: origin,
        payload: validExpensePayload(expenseId),
        clients: [],
      });

      expect(result).toEqual({
        kind: "no-navigation",
        reason: "INVALID_PAYLOAD",
      });
      expect((await subject.snapshot()).openedUrls).toEqual([]);
      expect((await subject.snapshot()).externalNavigationUrls).toEqual([]);
    },
  );

  it.each([
    ["notification-payload.v999", "expense-edit", "UNSUPPORTED_PAYLOAD_VERSION"],
    ["notification-payload.v1", "external-url", "UNSUPPORTED_CLICK_TARGET"],
  ] as const)(
    "[T-PUSH-SEC-002][PUSH-011] version=%s target=%s은 이동 없이 %s로 끝난다",
    async (payloadVersion, clickTarget, reason) => {
      const subject = createSubject();

      const result = await subject.handleNotificationClick({
        action: "default",
        applicationOrigin: origin,
        payload: {
          ...validExpensePayload(),
          payloadVersion,
          clickTarget,
        },
        clients: [],
      });

      expect(result).toEqual({ kind: "no-navigation", reason });
      expect(await subject.snapshot()).toEqual({
        focusedClients: [],
        openedUrls: [],
        externalNavigationUrls: [],
      });
    },
  );

  it("[T-PUSH-SEC-002][PUSH-006] dismiss action은 유효 payload여도 focus·open을 만들지 않는다", async () => {
    const subject = createSubject();

    const result = await subject.handleNotificationClick({
      action: "dismiss",
      applicationOrigin: origin,
      payload: validExpensePayload(),
      clients: [
        {
          clientId: "application-client",
          url: `${origin}/`,
          visibilityState: "visible",
        },
      ],
    });

    expect(result).toEqual({
      kind: "no-navigation",
      reason: "DISMISSED",
    });
    expect(await subject.snapshot()).toEqual({
      focusedClients: [],
      openedUrls: [],
      externalNavigationUrls: [],
    });
  });

  it("[T-PUSH-SEC-002][PUSH-006/PUSH-011] expenseId가 없는 payload는 편집 화면을 열지 않는다", async () => {
    const subject = createSubject();
    const payload = {
      payloadVersion: "notification-payload.v1",
      type: "expense-created",
      clickTarget: "expense-edit",
    };

    await expect(
      subject.handleNotificationClick({
        action: "default",
        applicationOrigin: origin,
        payload,
        clients: [],
      }),
    ).resolves.toEqual({
      kind: "no-navigation",
      reason: "INVALID_PAYLOAD",
    });
    expect(await subject.snapshot()).toEqual({
      focusedClients: [],
      openedUrls: [],
      externalNavigationUrls: [],
    });
  });

  it("[T-PUSH-SEC-002][PUSH-011] 같은 문자열로 시작하는 외부 origin 창은 focus하지 않는다", async () => {
    const subject = createSubject();

    await expect(
      subject.handleNotificationClick({
        action: "default",
        applicationOrigin: origin,
        payload: validExpensePayload(),
        clients: [
          {
            clientId: "deceptive-external-client",
            url: "https://household.example.evil/",
            visibilityState: "visible",
          },
        ],
      }),
    ).resolves.toEqual({
      kind: "opened",
      url: `${origin}/?edit=expense_A-1.2`,
    });
    expect((await subject.snapshot()).focusedClients).toEqual([]);
    expect((await subject.snapshot()).externalNavigationUrls).toEqual([]);
  });
});
