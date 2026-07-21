import { describe, expect, it } from "vitest";
import {
  createPwaPushPayloadDriver,
  type PwaPushPayloadDriver,
  type PwaPushPayloadFixture,
} from "../../../support/pwa-push-payload-driver";

export type PwaPushPayload =
  | {
      version: "notification.v1";
      notificationId: string;
      title: string;
      body: string;
      route: { kind: "expense" | "asset"; identifier: string };
    }
  | Readonly<Record<string, unknown>>;

export type PwaPushHandlingResult =
  | { kind: "Displayed"; notificationId: string }
  | {
      kind: "Rejected";
      code:
        | "VERSION_UNSUPPORTED"
        | "REQUIRED_FIELD_MISSING"
        | "FIELD_TYPE_INVALID"
        | "ROUTE_NOT_ALLOWED";
    };

export interface PwaPushPayloadValidationContractSubject
  extends PwaPushPayloadDriver {}

export function createSubject(
  fixture?: PwaPushPayloadFixture,
): PwaPushPayloadValidationContractSubject {
  return createPwaPushPayloadDriver(fixture);
}

const validPayload = {
  version: "notification.v1",
  notificationId: "notification-1",
  title: "지출 알림",
  body: "새 지출이 등록되었습니다.",
  route: { kind: "expense", identifier: "expense-1" },
} as const;

describe("PWA background push payload 경계 공개 계약", () => {
  it("[T-PWA-001][PWA-003] 지원하는 v1 최소 payload만 시스템 알림으로 표시한다", async () => {
    const subject = createSubject();

    expect(
      await subject.receive(validPayload),
    ).toEqual({ kind: "Displayed", notificationId: "notification-1" });
    expect(subject.state()).toEqual({
      displayedNotificationIds: ["notification-1"],
      contractFailureCodes: [],
    });
  });

  it.each([
    {
      name: "알 수 없는 version",
      payload: {
        version: "notification.v2",
        notificationId: "notification-2",
        title: "제목",
        body: "본문",
        route: { kind: "expense", identifier: "expense-1" },
      },
      code: "VERSION_UNSUPPORTED" as const,
    },
    {
      name: "필수 title 누락",
      payload: {
        version: "notification.v1",
        notificationId: "notification-3",
        body: "본문",
        route: { kind: "expense", identifier: "expense-1" },
      },
      code: "REQUIRED_FIELD_MISSING" as const,
    },
  ])(
    "[T-PWA-001][PWA-003] $name payload는 표시하지 않고 안정 contract failure만 기록한다",
    async ({ payload, code }) => {
      const subject = createSubject();

      expect(await subject.receive(payload)).toEqual({
        kind: "Rejected",
        code,
      });
      expect(subject.state()).toEqual({
        displayedNotificationIds: [],
        contractFailureCodes: [code],
      });
    },
  );

  it.each(["version", "notificationId", "title", "body", "route"] as const)(
    "[T-PWA-001][PWA-003] 필수 필드 $field 누락은 알림을 표시하지 않는다",
    async (field) => {
      const subject = createSubject();
      const payload: Record<string, unknown> = { ...validPayload };
      delete payload[field];

      expect(await subject.receive(payload)).toEqual({
        kind: "Rejected",
        code: "REQUIRED_FIELD_MISSING",
      });
      expect(subject.state()).toEqual({
        displayedNotificationIds: [],
        contractFailureCodes: ["REQUIRED_FIELD_MISSING"],
      });
    },
  );

  it.each([
    { name: "notificationId", payload: { ...validPayload, notificationId: 1 } },
    { name: "title", payload: { ...validPayload, title: false } },
    { name: "body", payload: { ...validPayload, body: [] } },
    { name: "route object", payload: { ...validPayload, route: "expense-1" } },
    {
      name: "route.kind",
      payload: { ...validPayload, route: { kind: 1, identifier: "expense-1" } },
    },
    {
      name: "route.identifier",
      payload: { ...validPayload, route: { kind: "expense", identifier: null } },
    },
  ])(
    "[T-PWA-001][PWA-003] 필수 필드 $name 타입 오류는 표시하지 않고 schema failure로 반환한다",
    async ({ payload }) => {
      const subject = createSubject();

      expect(await subject.receive(payload)).toEqual({
        kind: "Rejected",
        code: "FIELD_TYPE_INVALID",
      });
      expect(subject.state().displayedNotificationIds).toEqual([]);
      expect(subject.state().contractFailureCodes).toEqual([
        "FIELD_TYPE_INVALID",
      ]);
    },
  );

  it.each([
    { ...validPayload, notificationId: "" },
    { ...validPayload, title: "" },
    { ...validPayload, body: "" },
    { ...validPayload, route: { kind: "expense", identifier: "" } },
  ])(
    "[T-PWA-001][PWA-003] 빈 필수 문자열은 필드가 있어도 누락으로 거부한다",
    async (payload) => {
      const subject = createSubject();

      expect(await subject.receive(payload)).toEqual({
        kind: "Rejected",
        code: "REQUIRED_FIELD_MISSING",
      });
      expect(subject.state().displayedNotificationIds).toEqual([]);
    },
  );

  it("[T-PWA-001][PWA-003] schema에 없는 route kind는 임의 목적지로 해석하지 않는다", async () => {
    const subject = createSubject();

    expect(
      await subject.receive({
        ...validPayload,
        route: { kind: "admin", identifier: "expense-1" },
      }),
    ).toEqual({ kind: "Rejected", code: "ROUTE_NOT_ALLOWED" });
    expect(subject.state().displayedNotificationIds).toEqual([]);
  });

  it.each([
    "id/with/slash",
    "id?query=value",
    "id#fragment",
    "한글 식별자",
    "https://evil.example/x",
  ])(
    "[T-PWA-001][T-PWA-004][PWA-003/PWA-006] 식별자 %s는 외부 URL이 아니라 same-origin 단일 segment로만 표시 Adapter에 전달한다",
    async (identifier) => {
      const subject = createSubject();

      await expect(
        subject.receive({
          ...validPayload,
          route: { kind: "expense", identifier },
        }),
      ).resolves.toEqual({
        kind: "Displayed",
        notificationId: "notification-1",
      });
      expect(subject.displayedNotifications()).toEqual([
        expect.objectContaining({
          navigation: {
            origin: "https://household.example",
            destination: `/expenses/${encodeURIComponent(identifier)}`,
          },
        }),
      ]);
    },
  );

  it.each([
    ".",
    "../admin",
    "%2e%2e",
    "%252e%252e",
    "%255c..%255cadmin",
  ])(
    "[T-PWA-001][T-PWA-004][PWA-003/PWA-006] traversal 표현 %s는 알림 표시 전 신뢰 경계에서 거부한다",
    async (identifier) => {
      const subject = createSubject();

      await expect(
        subject.receive({
          ...validPayload,
          route: { kind: "expense", identifier },
        }),
      ).resolves.toEqual({ kind: "Rejected", code: "ROUTE_NOT_ALLOWED" });
      expect(subject.displayedNotifications()).toEqual([]);
      expect(subject.state().contractFailureCodes).toEqual([
        "ROUTE_NOT_ALLOWED",
      ]);
    },
  );

  it("[T-PWA-001][T-PWA-004][PWA-003/PWA-006] payload의 임의 URL과 추가 필드는 전달하지 않고 허용 route에서 최소 표시 payload를 다시 만든다", async () => {
    const subject = createSubject();

    await expect(
      subject.receive({
        ...validPayload,
        destination: "https://evil.example/phish",
        icon: "https://evil.example/icon.png",
        route: {
          ...validPayload.route,
          destination: "javascript:alert(1)",
        },
      }),
    ).resolves.toEqual({
      kind: "Displayed",
      notificationId: "notification-1",
    });
    expect(subject.displayedNotifications()).toEqual([
      {
        notificationId: "notification-1",
        title: "지출 알림",
        body: "새 지출이 등록되었습니다.",
        route: { kind: "expense", identifier: "expense-1" },
        navigation: {
          origin: "https://household.example",
          destination: "/expenses/expense-1",
        },
      },
    ]);
    expect(JSON.stringify(subject.displayedNotifications())).not.toContain(
      "evil.example",
    );
    expect(JSON.stringify(subject.displayedNotifications())).not.toContain(
      "javascript:",
    );
  });

  it.each([null, [], "notification.v1"])(
    "[T-PWA-001][PWA-003] object가 아닌 root payload %#는 schema failure로 거부한다",
    async (payload) => {
      const subject = createSubject();

      await expect(subject.receive(payload)).resolves.toEqual({
        kind: "Rejected",
        code: "FIELD_TYPE_INVALID",
      });
      expect(subject.displayedNotifications()).toEqual([]);
    },
  );

  it.each([
    {
      name: "cross-origin template",
      routeTemplates: {
        expense: "https://evil.example/:identifier",
        asset: "/assets/:identifier",
      },
    },
    {
      name: "정규화 뒤 허용 prefix를 벗어나는 template",
      routeTemplates: {
        expense: "/expenses/../admin/:identifier",
        asset: "/assets/:identifier",
      },
    },
  ])(
    "[T-PWA-001][T-PWA-004][PWA-003/PWA-006] $name은 payload가 유효해도 표시하지 않는다",
    async ({ routeTemplates }) => {
      const subject = createSubject({ routeTemplates });

      await expect(subject.receive(validPayload)).resolves.toEqual({
        kind: "Rejected",
        code: "ROUTE_NOT_ALLOWED",
      });
      expect(subject.displayedNotifications()).toEqual([]);
    },
  );
});
