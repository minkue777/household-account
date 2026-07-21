import { describe, expect, it } from "vitest";
import {
  createWebSecurityHeaderDriver,
  type BrowserSecurityDecision as SecurityDecision,
  type SecurityHeaderResult as HeaderResult,
  type WebResponseKind as ResponseKind,
  type WebSecurityHeaderDriver,
  type WebSecurityHeaderFixture,
  type WebSecurityHeaders as SecurityHeaders,
  type WebSecurityHeaderState as SecurityHeaderState,
} from "../../../support/web-security-header-driver";

export type WebResponseKind = ResponseKind;
export type WebSecurityHeaders = SecurityHeaders;
export type SecurityHeaderResult = HeaderResult;
export type BrowserSecurityDecision = SecurityDecision;
export type WebSecurityHeaderState = SecurityHeaderState;

export interface WebSecurityHeaderPolicyContractSubject
  extends WebSecurityHeaderDriver {}

export function createSubject(
  fixture: WebSecurityHeaderFixture,
): WebSecurityHeaderPolicyContractSubject {
  return createWebSecurityHeaderDriver(fixture);
}

const productionOrigin = "https://household.example";

const createSecuritySubject = (
  headerOverrides?: Readonly<Record<string, string | undefined>>,
): WebSecurityHeaderPolicyContractSubject =>
  createSubject({
    productionOrigin,
    https: true,
    allowedFirebaseOrigins: ["https://firebase.googleapis.com"],
    headerOverrides,
  });

const parseCsp = (value: string): ReadonlyMap<string, readonly string[]> =>
  new Map(
    value
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [directive, ...tokens] = part.split(/\s+/);
        return [directive, tokens] as const;
      }),
  );

const validCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "connect-src 'self' https://firebase.googleapis.com",
].join("; ");

const withoutCspDirective = (directive: string): string =>
  validCsp
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !part.startsWith(`${directive} `))
    .join("; ");

describe("production Web 응답 보안 header 공개 계약", () => {
  it.each(["document", "api"] as const)(
    "[T-PWA-005][PWA-007] production $kind 응답은 실행 가능한 최소 권한 CSP와 브라우저 보안 정책을 적용한다",
    (kind) => {
      const subject = createSecuritySubject();

      const result = subject.headersFor(kind);

      expect(result).toMatchObject({
        kind: "Applied",
        headers: {
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Permissions-Policy": expect.any(String),
          "Strict-Transport-Security": expect.any(String),
        },
      });
      if (result.kind !== "Applied") {
        throw new Error("유효한 production 보안 정책이 적용돼야 합니다.");
      }

      const csp = parseCsp(result.headers["Content-Security-Policy"]);
      expect(csp.get("default-src")).toEqual(["'self'"]);
      expect(csp.get("base-uri")).toEqual(["'self'"]);
      expect(csp.get("object-src")).toEqual(["'none'"]);
      expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
      expect(csp.get("script-src")).toContain("'self'");
      expect(csp.get("script-src")).not.toEqual(
        expect.arrayContaining(["*", "'unsafe-inline'", "'unsafe-eval'"]),
      );
      expect(csp.get("connect-src")).toEqual([
        "'self'",
        "https://firebase.googleapis.com",
      ]);
      expect(result.headers["Permissions-Policy"]).toMatch(/camera=\(\)/);
      expect(result.headers["Permissions-Policy"]).toMatch(/microphone=\(\)/);
      expect(result.headers["Permissions-Policy"]).toMatch(/geolocation=\(\)/);

      const hsts = result.headers["Strict-Transport-Security"] ?? "";
      const maxAge = Number(/(?:^|;)\s*max-age=(\d+)/i.exec(hsts)?.[1]);
      expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
      expect(hsts).toMatch(/(?:^|;)\s*includeSubDomains(?:;|$)/i);
      expect(subject.state().evaluatedResponses).toEqual([kind]);
    },
  );

  it.each([
    {
      name: "frame-ancestors wildcard",
      headerOverrides: {
        "Content-Security-Policy":
          "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors *; script-src 'self'; connect-src 'self' https://firebase.googleapis.com",
      },
    },
    {
      name: "unsafe script",
      headerOverrides: {
        "Content-Security-Policy":
          "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://firebase.googleapis.com",
      },
    },
    {
      name: "connect-src wildcard",
      headerOverrides: {
        "Content-Security-Policy":
          "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src *",
      },
    },
    {
      name: "unsafe referrer",
      headerOverrides: { "Referrer-Policy": "unsafe-url" },
    },
    {
      name: "disabled HSTS",
      headerOverrides: { "Strict-Transport-Security": "max-age=0" },
    },
    {
      name: "missing nosniff",
      headerOverrides: { "X-Content-Type-Options": undefined },
    },
  ])(
    "[T-PWA-005][PWA-007] $name 정책은 header가 존재해도 불완전 build로 거부한다",
    ({ headerOverrides }) => {
      const subject = createSecuritySubject(headerOverrides);

      expect(subject.headersFor("document")).toEqual({
        kind: "BuildFailed",
        code: "SECURITY_POLICY_INCOMPLETE",
      });
    },
  );

  it("[T-PWA-005][PWA-007] 허용하지 않은 외부 framing은 frame-ancestors 정책으로 차단한다", () => {
    const subject = createSecuritySubject();

    expect(subject.evaluateFrame("https://evil.example")).toEqual({
      kind: "Blocked",
      directive: "frame-ancestors",
    });
    expect(subject.state().blockedDecisions).toContainEqual({
      kind: "Blocked",
      directive: "frame-ancestors",
    });
  });

  it.each([
    { type: "script", origin: "https://evil.example", directive: "script-src" },
    { type: "connect", origin: "https://evil.example", directive: "connect-src" },
  ] as const)(
    "[T-PWA-005][PWA-007] allowlist 밖 $type resource는 $directive로 차단한다",
    ({ type, origin, directive }) => {
      const subject = createSecuritySubject();

      expect(subject.evaluateResource({ type, origin })).toEqual({
        kind: "Blocked",
        directive,
      });
      expect(subject.state().blockedDecisions).toEqual([
        { kind: "Blocked", directive },
      ]);
    },
  );

  it("[T-PWA-005][PWA-007] same-origin script와 명시된 Firebase connection만 허용한다", () => {
    const subject = createSecuritySubject();

    expect(
      subject.evaluateResource({ type: "script", origin: productionOrigin }),
    ).toEqual({ kind: "Allowed" });
    expect(
      subject.evaluateResource({
        type: "connect",
        origin: "https://firebase.googleapis.com",
      }),
    ).toEqual({ kind: "Allowed" });
    expect(subject.state().blockedDecisions).toEqual([]);
  });

  it.each([
    "default-src",
    "base-uri",
    "object-src",
    "frame-ancestors",
    "script-src",
    "connect-src",
  ])(
    "[T-PWA-005][PWA-007] 필수 CSP directive %s가 빠지면 production build를 거부한다",
    (directive) => {
      expect(
        createSecuritySubject({
          "Content-Security-Policy": withoutCspDirective(directive),
        }).headersFor("document"),
      ).toEqual({
        kind: "BuildFailed",
        code: "SECURITY_POLICY_INCOMPLETE",
      });
    },
  );

  it.each(["https://cdn.example", "data:"])(
    "[T-PWA-005][PWA-007] script-src의 임의 실행 출처 %s를 최소 권한 정책으로 인정하지 않는다",
    (source) => {
      const csp = validCsp.replace(
        "script-src 'self'",
        `script-src 'self' ${source}`,
      );

      expect(
        createSecuritySubject({
          "Content-Security-Policy": csp,
        }).headersFor("document"),
      ).toEqual({
        kind: "BuildFailed",
        code: "SECURITY_POLICY_INCOMPLETE",
      });
    },
  );

  it.each([
    "'nonce-requestScoped123='",
    "'sha256-YWJjZGVmZ2hpamtsbW5vcA=='",
    "'nonce-requestScoped123=' 'strict-dynamic'",
  ])(
    "[T-PWA-005][PWA-007] self와 안전한 request-scoped script source %s 조합은 허용한다",
    (source) => {
      const csp = validCsp.replace(
        "script-src 'self'",
        `script-src 'self' ${source}`,
      );

      expect(
        createSecuritySubject({
          "Content-Security-Policy": csp,
        }).headersFor("document"),
      ).toMatchObject({ kind: "Applied" });
    },
  );

  it.each([
    {
      name: "허용되지 않은 connection 추가",
      connect:
        "connect-src 'self' https://firebase.googleapis.com https://evil.example",
    },
    { name: "필수 Firebase connection 누락", connect: "connect-src 'self'" },
    { name: "scheme 전체 허용", connect: "connect-src 'self' https:" },
  ])(
    "[T-PWA-005][PWA-007] $name 상태의 connect-src는 build를 실패시킨다",
    ({ connect }) => {
      expect(
        createSecuritySubject({
          "Content-Security-Policy": validCsp.replace(
            "connect-src 'self' https://firebase.googleapis.com",
            connect,
          ),
        }).headersFor("api"),
      ).toEqual({
        kind: "BuildFailed",
        code: "SECURITY_POLICY_INCOMPLETE",
      });
    },
  );

  it("[T-PWA-005][PWA-007] 같은 CSP directive를 중복 선언해 브라우저 해석에 의존하는 정책은 거부한다", () => {
    expect(
      createSecuritySubject({
        "Content-Security-Policy": `${validCsp}; frame-ancestors *`,
      }).headersFor("document"),
    ).toEqual({
      kind: "BuildFailed",
      code: "SECURITY_POLICY_INCOMPLETE",
    });
  });

  it.each([
    "camera=(self), microphone=(), geolocation=()",
    "camera=(), microphone=(*), geolocation=()",
    "camera=(), microphone=()",
  ])(
    "[T-PWA-005][PWA-007] camera·microphone·geolocation 중 하나라도 비활성화하지 않은 Permissions-Policy를 거부한다",
    (permissionsPolicy) => {
      expect(
        createSecuritySubject({
          "Permissions-Policy": permissionsPolicy,
        }).headersFor("document"),
      ).toEqual({
        kind: "BuildFailed",
        code: "SECURITY_POLICY_INCOMPLETE",
      });
    },
  );

  it.each(["no-referrer", "same-origin", "strict-origin"])(
    "[T-PWA-005][PWA-007] 정보 노출을 줄이는 Referrer-Policy %s는 허용한다",
    (referrerPolicy) => {
      const result = createSecuritySubject({
        "Referrer-Policy": referrerPolicy,
      }).headersFor("document");

      expect(result).toMatchObject({
        kind: "Applied",
        headers: { "Referrer-Policy": referrerPolicy },
      });
    },
  );

  it("[T-PWA-005][PWA-007] HSTS 1년 경계값과 includeSubDomains를 모두 만족하면 허용한다", () => {
    expect(
      createSecuritySubject({
        "Strict-Transport-Security":
          "max-age=31536000; includeSubDomains; preload",
      }).headersFor("document"),
    ).toMatchObject({ kind: "Applied" });
  });

  it.each([
    "max-age=31535999; includeSubDomains",
    "max-age=31536000",
    "max-age=abc; includeSubDomains",
    "max-age=31536000; max-age=63072000; includeSubDomains",
  ])(
    "[T-PWA-005][PWA-007] 유효하지 않은 HSTS %s는 HTTPS production build를 실패시킨다",
    (hsts) => {
      expect(
        createSecuritySubject({
          "Strict-Transport-Security": hsts,
        }).headersFor("document"),
      ).toEqual({
        kind: "BuildFailed",
        code: "SECURITY_POLICY_INCOMPLETE",
      });
    },
  );

  it("[T-PWA-005][PWA-007] HTTP 응답에는 효과 없는 HSTS를 생성하지 않는다", () => {
    const result = createSubject({
      productionOrigin: "http://localhost:3000",
      https: false,
      allowedFirebaseOrigins: ["http://localhost:9099"],
    }).headersFor("document");
    if (result.kind !== "Applied") {
      throw new Error("유효한 HTTP fixture가 적용돼야 합니다.");
    }

    expect(result.headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it.each([
    {
      name: "production origin 형식 오류",
      configuredOrigin: "household.example",
      https: true,
      allowedFirebaseOrigins: ["https://firebase.googleapis.com"],
    },
    {
      name: "HTTPS flag와 HTTP origin 불일치",
      configuredOrigin: "http://household.example",
      https: true,
      allowedFirebaseOrigins: ["https://firebase.googleapis.com"],
    },
    {
      name: "Firebase wildcard origin",
      configuredOrigin: productionOrigin,
      https: true,
      allowedFirebaseOrigins: ["https://*.googleapis.com"],
    },
    {
      name: "Firebase origin에 path 포함",
      configuredOrigin: productionOrigin,
      https: true,
      allowedFirebaseOrigins: ["https://firebase.googleapis.com/v1"],
    },
    {
      name: "HTTPS page에서 HTTP Firebase origin 허용",
      configuredOrigin: productionOrigin,
      https: true,
      allowedFirebaseOrigins: ["http://firebase.googleapis.com"],
    },
  ])(
    "[T-PWA-005][PWA-007] $name 구성은 안전한 header build 입력이 아니다",
    ({ configuredOrigin, https, allowedFirebaseOrigins }) => {
      expect(
        createSubject({
          productionOrigin: configuredOrigin,
          https,
          allowedFirebaseOrigins,
        }).headersFor("document"),
      ).toEqual({
        kind: "BuildFailed",
        code: "SECURITY_POLICY_INCOMPLETE",
      });
    },
  );

  it("[T-PWA-005][PWA-007] HTTP header 이름의 대소문자를 바꿔도 unsafe override를 우회하지 못한다", () => {
    expect(
      createSecuritySubject({
        "content-security-policy": validCsp.replace(
          "frame-ancestors 'none'",
          "frame-ancestors *",
        ),
      }).headersFor("document"),
    ).toEqual({
      kind: "BuildFailed",
      code: "SECURITY_POLICY_INCOMPLETE",
    });
  });

  it("[T-PWA-005][PWA-007] frame-ancestors none은 same-origin parent도 예외 없이 차단한다", () => {
    expect(createSecuritySubject().evaluateFrame(productionOrigin)).toEqual({
      kind: "Blocked",
      directive: "frame-ancestors",
    });
  });

  it.each([
    {
      type: "connect" as const,
      origin: productionOrigin,
      expected: { kind: "Allowed" as const },
    },
    {
      type: "script" as const,
      origin: "https://firebase.googleapis.com",
      expected: { kind: "Blocked" as const, directive: "script-src" as const },
    },
    {
      type: "connect" as const,
      origin: "https://firebase.googleapis.com.evil.example",
      expected: {
        kind: "Blocked" as const,
        directive: "connect-src" as const,
      },
    },
    {
      type: "script" as const,
      origin: "javascript:alert(1)",
      expected: { kind: "Blocked" as const, directive: "script-src" as const },
    },
  ])(
    "[T-PWA-005][PWA-007] $type resource origin $origin을 directive 범위대로 판정한다",
    ({ type, origin, expected }) => {
      expect(
        createSecuritySubject().evaluateResource({ type, origin }),
      ).toEqual(expected);
    },
  );

  it("[T-PWA-005][PWA-007] document와 API 평가 이력을 호출 순서대로 공개한다", () => {
    const subject = createSecuritySubject();

    subject.headersFor("api");
    subject.headersFor("document");

    expect(subject.state().evaluatedResponses).toEqual(["api", "document"]);
  });
});
