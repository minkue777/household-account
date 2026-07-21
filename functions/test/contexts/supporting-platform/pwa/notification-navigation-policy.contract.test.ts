import { describe, expect, it } from "vitest";
import {
  createPwaNotificationNavigationDriver,
  type PwaNotificationNavigationDriver,
  type PwaNotificationNavigationFixture,
  type PwaNotificationNavigationState,
} from "../../../support/pwa-notification-navigation-driver";
import type {
  PwaNotificationNavigationResult,
  TrustedPwaNotificationRoute,
} from "../../../reference/pwa/public";

export type NotificationRoutePayload =
  | TrustedPwaNotificationRoute
  | Readonly<Record<string, unknown>>;

export type NotificationNavigationResult = PwaNotificationNavigationResult;
export type NotificationNavigationState = PwaNotificationNavigationState;

export interface NotificationNavigationPolicyContractSubject
  extends PwaNotificationNavigationDriver {}

export function createSubject(
  fixture: PwaNotificationNavigationFixture,
): NotificationNavigationPolicyContractSubject {
  return createPwaNotificationNavigationDriver(fixture);
}

const origin = "https://household.example";

const createNavigationSubject = (): NotificationNavigationPolicyContractSubject =>
  createSubject({
    origin,
    routeTemplates: {
      expense: "/expenses/:identifier",
      asset: "/assets/:identifier",
    },
    allowedRoutes: {
      expense: { pathPrefix: "/expenses/", segmentCount: 2 },
      asset: { pathPrefix: "/assets/", segmentCount: 2 },
    },
  });

describe("PWA 알림 클릭 same-origin route 공개 계약", () => {
  it.each(["id/with/slash", "id?query=value", "id#fragment", "한글 식별자", "https://evil.example/x"])(
    "[T-PWA-004][PWA-006] 식별자 %s를 path segment로 인코딩해 허용 route 안에서만 연다",
    (identifier) => {
      const subject = createNavigationSubject();
      const destination = `/expenses/${encodeURIComponent(identifier)}`;

      expect(
        subject.navigate({
          payload: { kind: "expense", identifier },
          matchingClientExists: false,
        }),
      ).toEqual({ kind: "Opened", destination, origin });
      expect(subject.state()).toEqual({
        focusedDestinations: [],
        openedDestinations: [destination],
      });
      expect(new URL(destination, origin).origin).toBe(origin);
    },
  );

  it("[T-PWA-004][PWA-006] 허용 route의 기존 client가 있으면 새 창 대신 그 destination을 focus한다", () => {
    const subject = createNavigationSubject();

    expect(
      subject.navigate({
        payload: { kind: "asset", identifier: "asset-1" },
        matchingClientExists: true,
      }),
    ).toEqual({
      kind: "Focused",
      destination: "/assets/asset-1",
      origin,
    });
    expect(subject.state()).toEqual({
      focusedDestinations: ["/assets/asset-1"],
      openedDestinations: [],
    });
  });

  it.each([
    { payload: { kind: "raw-url", destination: "https://evil.example/phish" } as const, code: "RAW_URL_NOT_ALLOWED" },
    { payload: { kind: "raw-url", destination: "javascript:alert(1)" } as const, code: "RAW_URL_NOT_ALLOWED" },
    { payload: { kind: "raw-url", destination: "/admin" } as const, code: "RAW_URL_NOT_ALLOWED" },
    { payload: { kind: "unknown", identifier: "transaction-1" } as const, code: "ROUTE_NOT_ALLOWED" },
    { payload: { kind: "expense", identifier: "" } as const, code: "INVALID_IDENTIFIER" },
  ] as const)(
    "[T-PWA-004][PWA-006] 구조화된 허용 route가 아닌 payload는 $code로 차단한다",
    ({ payload, code }) => {
      const subject = createNavigationSubject();

      expect(
        subject.navigate({ payload, matchingClientExists: false }),
      ).toEqual({ kind: "Rejected", code });
      expect(subject.state()).toEqual({
        focusedDestinations: [],
        openedDestinations: [],
      });
    },
  );

  it.each([
    ".",
    "..",
    "../admin",
    ".\\admin",
    "..\\admin",
    "%2e%2e",
    "%2E%2E%2Fadmin",
    "%252e%252e",
    "%255c..%255cadmin",
  ])(
    "[T-PWA-004][PWA-006] dot·percent·backslash traversal 식별자 %s는 decode 깊이와 무관하게 거부한다",
    (identifier) => {
      const subject = createNavigationSubject();

      expect(
        subject.navigate({
          payload: { kind: "expense", identifier },
          matchingClientExists: false,
        }),
      ).toEqual({ kind: "Rejected", code: "PATH_TRAVERSAL" });
      expect(subject.state()).toEqual({
        focusedDestinations: [],
        openedDestinations: [],
      });
    },
  );

  it.each([
    {
      name: "URL 정규화 뒤 prefix 이탈",
      routeTemplates: {
        expense: "/expenses/../admin/:identifier",
        asset: "/assets/:identifier",
      },
    },
    {
      name: "허용 segment 수 초과",
      routeTemplates: {
        expense: "/expenses/:identifier/details",
        asset: "/assets/:identifier",
      },
    },
    {
      name: "cross-origin template",
      routeTemplates: {
        expense: "https://evil.example/:identifier",
        asset: "/assets/:identifier",
      },
    },
    {
      name: "빈 중간 segment가 있는 template",
      routeTemplates: {
        expense: "/expenses//:identifier",
        asset: "/assets/:identifier",
      },
    },
  ])(
    "[T-PWA-004][PWA-006] $name route template은 URL 정규화 후 허용 prefix·segment shape 검사에서 거부한다",
    ({ routeTemplates }) => {
      const subject = createSubject({
        origin,
        routeTemplates,
        allowedRoutes: {
          expense: { pathPrefix: "/expenses/", segmentCount: 2 },
          asset: { pathPrefix: "/assets/", segmentCount: 2 },
        },
      });

      expect(
        subject.navigate({
          payload: { kind: "expense", identifier: "expense-1" },
          matchingClientExists: false,
        }),
      ).toEqual({ kind: "Rejected", code: "ROUTE_SHAPE_INVALID" });
      expect(subject.state().openedDestinations).toEqual([]);
    },
  );

  it.each([
    {
      name: "query가 포함된 template",
      expenseTemplate: "/expenses/:identifier?next=/admin",
    },
    {
      name: "fragment가 포함된 template",
      expenseTemplate: "/expenses/:identifier#admin",
    },
  ])(
    "[T-PWA-004][PWA-006] $name은 route 밖 데이터를 만들 수 있어 거부한다",
    ({ expenseTemplate }) => {
      const subject = createSubject({
        origin,
        routeTemplates: {
          expense: expenseTemplate,
          asset: "/assets/:identifier",
        },
        allowedRoutes: {
          expense: { pathPrefix: "/expenses/", segmentCount: 2 },
          asset: { pathPrefix: "/assets/", segmentCount: 2 },
        },
      });

      expect(
        subject.navigate({
          payload: { kind: "expense", identifier: "expense-1" },
          matchingClientExists: false,
        }),
      ).toEqual({ kind: "Rejected", code: "ROUTE_SHAPE_INVALID" });
      expect(subject.state()).toEqual({
        focusedDestinations: [],
        openedDestinations: [],
      });
    },
  );

  it.each(["javascript:alert(1)", "not-a-url", "file:///tmp"])(
    "[T-PWA-004][PWA-006] HTTP(S) origin이 아닌 설정 %s은 navigation을 만들지 않는다",
    (invalidOrigin) => {
      const subject = createSubject({
        origin: invalidOrigin,
        routeTemplates: {
          expense: "/expenses/:identifier",
          asset: "/assets/:identifier",
        },
        allowedRoutes: {
          expense: { pathPrefix: "/expenses/", segmentCount: 2 },
          asset: { pathPrefix: "/assets/", segmentCount: 2 },
        },
      });

      expect(
        subject.navigate({
          payload: { kind: "expense", identifier: "expense-1" },
          matchingClientExists: true,
        }),
      ).toEqual({ kind: "Rejected", code: "ROUTE_SHAPE_INVALID" });
      expect(subject.state()).toEqual({
        focusedDestinations: [],
        openedDestinations: [],
      });
    },
  );

  it.each([
    ["placeholder 누락", "/expenses/static"],
    ["placeholder 중복", "/expenses/:identifier/:identifier"],
  ])(
    "[T-PWA-004][PWA-006] %s template은 결정적인 단일 segment route가 아니므로 거부한다",
    (_name, expenseTemplate) => {
      const subject = createSubject({
        origin,
        routeTemplates: {
          expense: expenseTemplate,
          asset: "/assets/:identifier",
        },
        allowedRoutes: {
          expense: { pathPrefix: "/expenses/", segmentCount: 2 },
          asset: { pathPrefix: "/assets/", segmentCount: 2 },
        },
      });

      expect(
        subject.navigate({
          payload: { kind: "expense", identifier: "expense-1" },
          matchingClientExists: false,
        }),
      ).toEqual({ kind: "Rejected", code: "ROUTE_SHAPE_INVALID" });
      expect(subject.state().openedDestinations).toEqual([]);
    },
  );
});
