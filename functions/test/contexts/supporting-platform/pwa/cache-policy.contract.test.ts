import { describe, expect, it } from "vitest";
import {
  createPwaRuntimeCacheDriver,
  type PwaCacheAdmissionDecision,
  type PwaOfflineReadResult,
  type PwaRuntimeCacheCandidate,
  type PwaRuntimeCacheDriver,
  type PwaRuntimeCacheFixture,
  type PwaRuntimeCacheState,
} from "../../../support/pwa-runtime-cache-driver";

export type PwaResponseCandidate = PwaRuntimeCacheCandidate;
export type CacheAdmissionDecision = PwaCacheAdmissionDecision;
export type OfflineReadResult = PwaOfflineReadResult;
export type PwaCacheState = PwaRuntimeCacheState;

export interface PwaCachePolicyContractSubject extends PwaRuntimeCacheDriver {}

export function createSubject(
  fixture?: PwaRuntimeCacheFixture,
): PwaCachePolicyContractSubject {
  return createPwaRuntimeCacheDriver(fixture);
}

const origin = "https://household.example";

const candidate = (
  requestUrl: string,
  overrides: Partial<PwaResponseCandidate> = {},
): PwaResponseCandidate => ({
  requestUrl,
  requestMethod: "GET",
  requestMode: "same-origin",
  responseStatus: 200,
  responseContentType: "image/png",
  responseHeaders: { "cache-control": "public, max-age=604800" },
  receivedAt: "2026-07-19T00:00:00.000Z",
  bodyMarker: `body:${requestUrl}`,
  ...overrides,
});

const createCacheSubject = (): PwaCachePolicyContractSubject =>
  createSubject({
    origin,
    publicRuntimeAllowlist: [
      "/icons/app-192.png",
      "/fonts/app.woff2",
      "/images/brand.webp",
    ],
  });

describe("PWA runtime cache 공개 계약", () => {
  it.each([
    ["/icons/app-192.png", "image/png"],
    ["/fonts/app.woff2", "font/woff2"],
    ["/images/brand.webp", "image/webp"],
  ])(
    "[T-PWA-002/T-PWA-006][PWA-004/PWA-008][DEC-051] allowlist의 공개 정적 자원 %s만 runtime cache에 저장한다",
    async (path, contentType) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}${path}`;

      expect(
        await subject.receive(
          candidate(requestUrl, { responseContentType: contentType }),
        ),
      ).toEqual({
        kind: "Cached",
        expiresAt: "2026-07-26T00:00:00.000Z",
      });
      expect(
        await subject.readOffline(requestUrl, "2026-07-25T23:59:59.999Z"),
      ).toEqual({
        kind: "CacheHit",
        bodyMarker: `body:${requestUrl}`,
        originalReceivedAt: "2026-07-19T00:00:00.000Z",
      });
    },
  );

  it("[T-PWA-006][PWA-008][DEC-051] 공개 자원도 받은 시각부터 정확히 7일이 되면 stale 응답을 반환하지 않는다", async () => {
    const subject = createCacheSubject();
    const requestUrl = `${origin}/icons/app-192.png`;
    await subject.receive(candidate(requestUrl));

    expect(
      await subject.readOffline(requestUrl, "2026-07-26T00:00:00.000Z"),
    ).toEqual({ kind: "NetworkUnavailable" });
    expect(subject.state().cachedUrls).not.toContain(requestUrl);
  });

  it.each([
    "/api/auth/session",
    "/api/households/household-1",
    "/api/expenses",
    "/api/assets",
    "/api/public-status",
  ])(
    "[T-PWA-002][PWA-004/PWA-008] %s 응답은 성공 여부와 무관하게 cache하지 않는다",
    async (path) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}${path}`;

      expect(
        await subject.receive(
          candidate(requestUrl, {
            responseContentType: "application/json",
            bodyMarker: "sensitive-response",
          }),
        ),
      ).toEqual({ kind: "NetworkOnly" });
      expect(
        await subject.readOffline(requestUrl, "2026-07-19T00:01:00.000Z"),
      ).toEqual({ kind: "NetworkUnavailable" });
    },
  );

  it("[T-PWA-002/T-PWA-006][PWA-004/PWA-008] navigation HTML은 route가 공개 화면이어도 offline cache로 재생하지 않는다", async () => {
    const subject = createCacheSubject();
    const requestUrl = `${origin}/expenses`;

    expect(
      await subject.receive(
        candidate(requestUrl, {
          requestMode: "navigate",
          responseContentType: "text/html; charset=utf-8",
          bodyMarker: "session-bound-html",
        }),
      ),
    ).toEqual({ kind: "NetworkOnly" });
    expect(
      await subject.readOffline(requestUrl, "2026-07-19T00:01:00.000Z"),
    ).toEqual({ kind: "NetworkUnavailable" });
  });

  it.each(["authorization", "cookie"])(
    "[T-PWA-002][PWA-004] %s가 있는 응답은 정적 확장자나 allowlist 경로여도 cache하지 않는다",
    async (headerName) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}/icons/app-192.png`;

      expect(
        await subject.receive(
          candidate(requestUrl, {
            requestHeaders: { [headerName]: "credential-value" },
          }),
        ),
      ).toEqual({ kind: "NetworkOnly" });
      expect(subject.state().cachedUrls).toEqual([]);
    },
  );

  it.each(["HEAD", "POST", "PUT", "PATCH", "DELETE"] as const)(
    "[T-PWA-002/T-PWA-006][PWA-004/PWA-008] $method 요청은 공개 allowlist 경로여도 runtime cache에 저장하지 않는다",
    async (requestMethod) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}/icons/app-192.png`;

      expect(
        await subject.receive(candidate(requestUrl, { requestMethod })),
      ).toEqual({ kind: "NetworkOnly" });
      expect(subject.state().cachedUrls).toEqual([]);
    },
  );

  it.each([
    ["Set-Cookie", "set-cookie", "sid=secret"],
    ["Cache-Control private", "cache-control", "private, max-age=604800"],
    ["Cache-Control no-store", "cache-control", "public, no-store"],
    ["Cache-Control no-cache", "cache-control", "public, no-cache"],
  ] as const)(
    "[T-PWA-002/T-PWA-006][PWA-004/PWA-008] $0 응답은 공개 경로여도 저장하지 않는다",
    async (_name, headerName, headerValue) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}/icons/app-192.png`;

      expect(
        await subject.receive(
          candidate(requestUrl, {
            responseHeaders: { [headerName]: headerValue },
          }),
        ),
      ).toEqual({ kind: "NetworkOnly" });
      expect(subject.state().cacheKeys).toEqual([]);
    },
  );

  it.each([
    "uid=user-123",
    "householdId=household-456",
    "memberId=member-789",
    "token=private-token",
  ])(
    "[T-PWA-002][PWA-004] 개인정보 query %s가 포함된 URL은 cache key를 만들지 않는다",
    async (query) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}/icons/app-192.png?${query}`;

      expect(await subject.receive(candidate(requestUrl))).toEqual({
        kind: "NetworkOnly",
      });
      expect(subject.state()).toMatchObject({ cachedUrls: [], cacheKeys: [] });
      expect(subject.state().cacheKeys.join("|")).not.toMatch(
        /user-123|household-456|member-789|private-token/,
      );
    },
  );

  it("[T-PWA-006][PWA-008][DEC-051] allowlist 밖 same-origin 이미지와 임의 cross-origin 응답은 cache하지 않는다", async () => {
    const subject = createCacheSubject();

    expect(
      await subject.receive(candidate(`${origin}/uploads/account-image.png`)),
    ).toEqual({ kind: "NetworkOnly" });
    expect(
      await subject.receive(
        candidate("https://cdn.untrusted.example/icons/app-192.png", {
          requestMode: "cors",
        }),
      ),
    ).toEqual({ kind: "NetworkOnly" });
    expect(subject.state().cachedUrls).toEqual([]);
  });

  it.each([199, 204, 206, 301, 404, 500])(
    "[T-PWA-002/T-PWA-006][PWA-004/PWA-008] HTTP status %s 응답은 allowlist 자원이어도 성공 cache로 저장하지 않는다",
    async (responseStatus) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}/icons/app-192.png`;

      await expect(
        subject.receive(candidate(requestUrl, { responseStatus })),
      ).resolves.toEqual({ kind: "NetworkOnly" });
      expect(subject.state()).toEqual({ cachedUrls: [], cacheKeys: [] });
    },
  );

  it.each(["application/json", "text/html; charset=utf-8"])(
    "[T-PWA-002/T-PWA-006][PWA-004/PWA-008] 공개 allowlist URL도 MIME %s 응답이면 정적 이미지·폰트로 cache하지 않는다",
    async (responseContentType) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}/icons/app-192.png`;

      await expect(
        subject.receive(candidate(requestUrl, { responseContentType })),
      ).resolves.toEqual({ kind: "NetworkOnly" });
      expect(subject.state().cachedUrls).toEqual([]);
    },
  );

  it.each([
    "/api/public-status",
    "/households/avatar.png",
    "/expenses/export.png",
    "/assets/chart.png",
    "/statistics/chart.png",
  ])(
    "[T-PWA-002][PWA-004/PWA-008] 민감 경로 %s는 설정 allowlist에 잘못 들어가도 deny 규칙이 우선한다",
    async (path) => {
      const subject = createSubject({
        origin,
        publicRuntimeAllowlist: [path],
      });
      const requestUrl = `${origin}${path}`;

      await expect(subject.receive(candidate(requestUrl))).resolves.toEqual({
        kind: "NetworkOnly",
      });
      expect(subject.state()).toEqual({ cachedUrls: [], cacheKeys: [] });
    },
  );

  it.each([
    `${origin}/icons/app-192.png?v=1`,
    `${origin}/icons/app-192.png#private-fragment`,
    "https://user:secret@household.example/icons/app-192.png",
  ])(
    "[T-PWA-002][PWA-004] identity나 변형 query가 섞일 수 있는 URL %s는 결정 cache key로 사용하지 않는다",
    async (requestUrl) => {
      const subject = createCacheSubject();

      await expect(subject.receive(candidate(requestUrl))).resolves.toEqual({
        kind: "NetworkOnly",
      });
      expect(subject.state()).toEqual({ cachedUrls: [], cacheKeys: [] });
    },
  );

  it.each([
    ["public, max-age=60", "2026-07-19T00:01:00.000Z"],
    ["public, max-age=1209600", "2026-07-26T00:00:00.000Z"],
  ])(
    "[T-PWA-006][PWA-008][DEC-051] Cache-Control %s은 서버의 더 짧은 TTL을 따르되 7일을 넘기지 않는다",
    async (cacheControl, expiresAt) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}/icons/app-192.png`;

      await expect(
        subject.receive(
          candidate(requestUrl, {
            responseHeaders: { "cache-control": cacheControl },
          }),
        ),
      ).resolves.toEqual({ kind: "Cached", expiresAt });
      await expect(subject.readOffline(requestUrl, expiresAt)).resolves.toEqual({
        kind: "NetworkUnavailable",
      });
    },
  );

  it.each([
    {
      name: "대소문자가 다른 Authorization request header",
      overrides: { requestHeaders: { AuThOrIzAtIoN: "credential" } },
    },
    {
      name: "대소문자가 다른 Set-Cookie response header",
      overrides: { responseHeaders: { "SET-cookie": "sid=secret" } },
    },
  ])(
    "[T-PWA-002][PWA-004] $name도 HTTP header 이름 규칙대로 차단한다",
    async ({ overrides }) => {
      const subject = createCacheSubject();
      const requestUrl = `${origin}/icons/app-192.png`;

      await expect(
        subject.receive(candidate(requestUrl, overrides)),
      ).resolves.toEqual({ kind: "NetworkOnly" });
      expect(subject.state().cachedUrls).toEqual([]);
    },
  );

  it("[T-PWA-006][PWA-008][DEC-051] 저장 시각이 유효하지 않으면 TTL을 추정하지 않고 cache하지 않는다", async () => {
    const subject = createCacheSubject();
    const requestUrl = `${origin}/icons/app-192.png`;

    await expect(
      subject.receive(candidate(requestUrl, { receivedAt: "not-a-date" })),
    ).resolves.toEqual({ kind: "NetworkOnly" });
    expect(subject.state()).toEqual({ cachedUrls: [], cacheKeys: [] });
  });
});
