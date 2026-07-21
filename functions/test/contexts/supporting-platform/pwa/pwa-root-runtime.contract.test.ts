import { describe, expect, it } from "vitest";
import {
  createPwaRootRuntimeDriver,
  type PwaClickResult as RootClickResult,
  type PwaLogoutResult as RootLogoutResult,
  type PwaPageResult as RootPageResult,
  type PwaPublicAssetResult as RootPublicAssetResult,
  type PwaPushResult as RootPushResult,
  type PwaRootRegistration,
  type PwaRootRuntimeDriver,
  type PwaRootRuntimeFixture,
  type PwaRootRuntimeState as RootRuntimeState,
  type PwaRuntimeInitializationResult as RuntimeInitializationResult,
} from "../../../support/pwa-root-runtime-driver";

export type PwaRuntimeInitializationResult = RuntimeInitializationResult;
export type PwaPageResult = RootPageResult;
export type PwaPublicAssetResult = RootPublicAssetResult;
export type PwaPushResult = RootPushResult;
export type PwaClickResult = RootClickResult;
export type PwaLogoutResult = RootLogoutResult;
export type PwaRootRuntimeState = RootRuntimeState;
export type LegacyRootRegistrationFixture = PwaRootRegistration;

export interface PwaRootRuntimeContractSubject extends PwaRootRuntimeDriver {}

export function createSubject(
  fixture?: PwaRootRuntimeFixture,
): PwaRootRuntimeContractSubject {
  return createPwaRootRuntimeDriver(fixture);
}

const iphoneLogin = (memberId: string, generation: string) => ({
  environment: "production" as const,
  displayMode: "standalone" as const,
  deviceClass: "iphone-home-pwa" as const,
  authenticatedMemberId: memberId,
  fid: "fid-installation-1",
  sessionGeneration: generation,
});

describe("PWA 단일 root worker 통합 런타임 공개 계약", () => {
  it("[T-PWA-001][PWA-003] production의 한 root worker가 page·cache·push·click과 Messaging handoff를 함께 제공한다", async () => {
    const subject = createSubject();

    const initialized = await subject.initialize(
      iphoneLogin("member-1", "generation-1"),
    );

    expect(initialized).toEqual({
      kind: "Ready",
      registrationId: expect.any(String),
      scope: "/",
    });
    if (initialized.kind !== "Ready") {
      throw new Error("production PWA가 Ready여야 합니다.");
    }
    expect(subject.requestPage("/expenses")).toEqual({
      kind: "PageServed",
      registrationId: initialized.registrationId,
    });
    expect(subject.fetchPublicAsset("/icons/icon-192.png")).toEqual({
      kind: "CacheServed",
      registrationId: initialized.registrationId,
      path: "/icons/icon-192.png",
    });
    expect(subject.receiveBackgroundPush("notification-1")).toEqual({
      kind: "Displayed",
      registrationId: initialized.registrationId,
      notificationId: "notification-1",
    });
    expect(subject.clickNotification("/expenses/transaction-1", true)).toEqual({
      kind: "Focused",
      registrationId: initialized.registrationId,
      destination: "/expenses/transaction-1",
    });
    expect(subject.state()).toMatchObject({
      registrations: [
        {
          registrationId: initialized.registrationId,
          scope: "/",
          scriptUrl: "/sw.js",
          capabilities: ["page", "cache", "push", "notification-click"],
        },
      ],
      messagingRegistrationIds: [initialized.registrationId],
    });
  });

  it("[T-PWA-001][PWA-003] 기존 sw.js와 firebase-messaging-sw.js root 충돌을 통합해 별도 messaging worker를 남기지 않는다", async () => {
    const subject = createSubject({
      initialRegistrations: [
        {
          registrationId: "legacy-cache-worker",
          scope: "/",
          scriptUrl: "/sw.js",
          capabilities: ["page", "cache"],
        },
        {
          registrationId: "legacy-firebase-worker",
          scope: "/",
          scriptUrl: "/firebase-messaging-sw.js",
          capabilities: ["push", "notification-click"],
        },
      ],
    });

    const initialized = await subject.initialize(
      iphoneLogin("member-1", "generation-1"),
    );

    expect(initialized).toMatchObject({ kind: "Ready", scope: "/" });
    expect(subject.state().registrations).toHaveLength(1);
    expect(subject.state().registrations[0]).toMatchObject({
      scope: "/",
      scriptUrl: "/sw.js",
      capabilities: ["page", "cache", "push", "notification-click"],
    });
    expect(subject.state().registrations.map(({ scriptUrl }) => scriptUrl)).toEqual([
      "/sw.js",
    ]);
    expect(subject.state().retiredRegistrationIds).toContain(
      "legacy-firebase-worker",
    );
    expect(subject.state().messagingRegistrationIds).toEqual([
      subject.state().registrations[0].registrationId,
    ]);
  });

  it("[T-PWA-001][PWA-003] 로그인한 iPhone 홈 화면 PWA는 FID를 등록하고 logout 때 endpoint 삭제와 session purge를 끝낸다", async () => {
    const subject = createSubject();
    await subject.initialize(iphoneLogin("member-1", "generation-1"));

    expect(await subject.logout()).toEqual({
      kind: "LoggedOut",
      removedFid: "fid-installation-1",
      sessionGeneration: undefined,
    });
    expect(subject.state()).toMatchObject({
      sessionGeneration: undefined,
      sessionCleanup: "clean",
      endpointEvents: [
        { kind: "Registered", fid: "fid-installation-1", memberId: "member-1" },
        { kind: "RemovalSucceeded", fid: "fid-installation-1" },
        { kind: "SessionPurged", previousGeneration: "generation-1" },
      ],
    });
  });

  it("[T-PWA-001/T-PWA-002][PWA-003/PWA-004] RemoveEndpoint 실패는 이전 session을 격리하고 새 endpoint 등록을 막으며 성공한 retry 뒤에만 재등록한다", async () => {
    const subject = createSubject({
      endpointRemovalResults: ["failure", "success"],
      sessionPurgeResults: ["success"],
    });
    await subject.initialize(iphoneLogin("member-A", "generation-A"));

    expect(await subject.logout()).toEqual({
      kind: "FailedAndIsolated",
      code: "ENDPOINT_REMOVAL_FAILED",
      sessionGeneration: undefined,
    });
    expect(
      await subject.initialize(iphoneLogin("member-B", "generation-B")),
    ).toEqual({
      kind: "Failed",
      code: "PREVIOUS_SESSION_CLEANUP_REQUIRED",
    });
    expect(
      subject.state().endpointEvents.filter(({ kind }) => kind === "Registered"),
    ).toEqual([
      { kind: "Registered", fid: "fid-installation-1", memberId: "member-A" },
    ]);

    expect(await subject.logout()).toMatchObject({ kind: "LoggedOut" });
    expect(
      await subject.initialize(iphoneLogin("member-B", "generation-B")),
    ).toMatchObject({ kind: "Ready" });
    expect(subject.state().endpointEvents).toEqual([
      { kind: "Registered", fid: "fid-installation-1", memberId: "member-A" },
      { kind: "RemovalFailed", fid: "fid-installation-1" },
      { kind: "RemovalSucceeded", fid: "fid-installation-1" },
      { kind: "SessionPurged", previousGeneration: "generation-A" },
      { kind: "Registered", fid: "fid-installation-1", memberId: "member-B" },
    ]);
  });

  it("[T-PWA-001/T-PWA-002][PWA-003/PWA-004] endpoint 삭제 뒤 session purge가 실패해도 새 endpoint는 등록하지 않고 purge 성공 뒤에만 연다", async () => {
    const subject = createSubject({
      endpointRemovalResults: ["success"],
      sessionPurgeResults: ["failure", "success"],
    });
    await subject.initialize(iphoneLogin("member-A", "generation-A"));

    expect(await subject.logout()).toEqual({
      kind: "FailedAndIsolated",
      code: "SESSION_PURGE_FAILED",
      sessionGeneration: undefined,
    });
    expect(
      await subject.initialize(iphoneLogin("member-B", "generation-B")),
    ).toMatchObject({ kind: "Failed" });
    expect(subject.state().endpointEvents.at(-1)).toEqual({
      kind: "SessionPurgeFailed",
      previousGeneration: "generation-A",
    });

    expect(await subject.logout()).toMatchObject({ kind: "LoggedOut" });
    expect(
      await subject.initialize(iphoneLogin("member-B", "generation-B")),
    ).toMatchObject({ kind: "Ready" });
    expect(subject.state().endpointEvents.slice(-2)).toEqual([
      { kind: "SessionPurged", previousGeneration: "generation-A" },
      { kind: "Registered", fid: "fid-installation-1", memberId: "member-B" },
    ]);
  });

  it("[T-PWA-001][PWA-003][DEC-020] 인증되지 않은 iPhone, 홈 화면 밖 browser mode, desktop은 알림 권한·FID 등록 대상이 아니다", async () => {
    const cases = [
      {
        displayMode: "standalone" as const,
        deviceClass: "iphone-home-pwa" as const,
      },
      {
        displayMode: "browser" as const,
        deviceClass: "iphone-home-pwa" as const,
        authenticatedMemberId: "member-1",
        fid: "fid-browser-mode",
      },
      {
        displayMode: "browser" as const,
        deviceClass: "desktop" as const,
        authenticatedMemberId: "member-1",
        fid: "fid-desktop",
      },
    ];

    for (const input of cases) {
      const subject = createSubject();
      expect(
        await subject.initialize({ environment: "production", ...input }),
      ).toMatchObject({ kind: "Ready", scope: "/" });
      expect(subject.receiveBackgroundPush("notification-1")).toEqual({
        kind: "NotSupportedForDevice",
      });
      expect(subject.state()).toMatchObject({
        messagingPermissionRequested: false,
        messagingRegistrationIds: [],
        endpointEvents: [],
      });
    }
  });

  it("[T-PWA-001][PWA-003] 두 탭이 동시에 초기화해도 한 root registration과 한 endpoint 등록을 재사용한다", async () => {
    const subject = createSubject();
    const input = iphoneLogin("member-1", "generation-1");

    const [first, second] = await Promise.all([
      subject.initialize(input),
      subject.initialize(input),
    ]);

    expect(first).toMatchObject({ kind: "Ready", scope: "/" });
    expect(second).toEqual(first);
    if (first.kind !== "Ready") {
      throw new Error("production PWA가 Ready여야 합니다.");
    }
    expect(subject.state().registrations).toHaveLength(1);
    expect(subject.state().messagingRegistrationIds).toEqual([
      first.registrationId,
    ]);
    expect(subject.state().endpointEvents).toEqual([
      { kind: "Registered", fid: "fid-installation-1", memberId: "member-1" },
    ]);
  });

  it("[T-PWA-001][PWA-003] active version과 다른 waiting worker가 있으면 성공으로 숨기지 않고 UpdateAvailable을 반환한다", async () => {
    const subject = createSubject({
      activeWorkerVersion: "worker-v1",
      waitingWorkerVersion: "worker-v2",
    });

    expect(
      await subject.initialize({
        environment: "production",
        displayMode: "standalone",
        deviceClass: "iphone-home-pwa",
      }),
    ).toEqual({
      kind: "UpdateAvailable",
      registrationId: expect.any(String),
      activeWorkerVersion: "worker-v1",
      waitingWorkerVersion: "worker-v2",
    });
  });

  it("[T-PWA-001][PWA-001/PWA-003] production worker 등록 실패는 Ready로 숨기지 않고 endpoint·기능을 만들지 않는다", async () => {
    const subject = createSubject({ workerRegistrationResult: "failure" });

    expect(
      await subject.initialize(iphoneLogin("member-1", "generation-1")),
    ).toEqual({
      kind: "Failed",
      code: "WORKER_REGISTRATION_FAILED",
    });
    expect(subject.state()).toMatchObject({
      registrations: [],
      messagingRegistrationIds: [],
      endpointEvents: [],
    });
  });

  it("[T-PWA-001][PWA-001] development에서는 새 PWA worker를 등록하지 않는다", async () => {
    const subject = createSubject();

    expect(
      await subject.initialize({
        environment: "development",
        displayMode: "browser",
        deviceClass: "desktop",
      }),
    ).toEqual({ kind: "DisabledInDevelopment" });
    expect(subject.state()).toMatchObject({
      registrations: [],
      messagingPermissionRequested: false,
      messagingRegistrationIds: [],
      endpointEvents: [],
    });
  });

  it("[T-PWA-001/T-PWA-003][PWA-003/PWA-005] build에서 검증된 단일 sw.js root registration은 교체하지 않고 모든 capability가 같은 ID를 재사용한다", async () => {
    const subject = createSubject({
      workerArtifactPaths: ["/sw.js"],
      initialRegistrations: [
        {
          registrationId: "deployed-root-worker",
          scope: "/",
          scriptUrl: "/sw.js",
          capabilities: ["page", "cache", "push", "notification-click"],
        },
      ],
    });

    expect(
      await subject.initialize(iphoneLogin("member-1", "generation-1")),
    ).toEqual({
      kind: "Ready",
      registrationId: "deployed-root-worker",
      scope: "/",
    });
    expect(subject.state()).toMatchObject({
      registrations: [
        {
          registrationId: "deployed-root-worker",
          scriptUrl: "/sw.js",
        },
      ],
      retiredRegistrationIds: [],
      messagingRegistrationIds: ["deployed-root-worker"],
    });
  });

  it.each([
    { name: "worker artifact 없음", workerArtifactPaths: [] },
    {
      name: "구 Firebase worker만 존재",
      workerArtifactPaths: ["/firebase-messaging-sw.js"],
    },
    {
      name: "통합 worker와 구 worker가 함께 존재",
      workerArtifactPaths: ["/sw.js", "/firebase-messaging-sw.js"],
    },
    {
      name: "sw.js가 중복 산출됨",
      workerArtifactPaths: ["/sw.js", "/sw.js"],
    },
  ])(
    "[T-PWA-001/T-PWA-003][PWA-003/PWA-005] $name 상태에서는 root runtime을 시작하지 않는다",
    async ({ workerArtifactPaths }) => {
      const subject = createSubject({ workerArtifactPaths });

      expect(
        await subject.initialize(iphoneLogin("member-1", "generation-1")),
      ).toEqual({ kind: "Failed", code: "WORKER_ARTIFACT_INVALID" });
      expect(subject.state()).toMatchObject({
        registrations: [],
        retiredRegistrationIds: [],
        messagingPermissionRequested: false,
        messagingRegistrationIds: [],
        endpointEvents: [],
      });
    },
  );

  it("[T-PWA-001/T-PWA-003][PWA-003/PWA-005] 검증되지 않은 build artifact는 기존 registration까지 임의로 정리하지 않는다", async () => {
    const legacyRegistration: LegacyRootRegistrationFixture = {
      registrationId: "legacy-firebase-worker",
      scope: "/",
      scriptUrl: "/firebase-messaging-sw.js",
      capabilities: ["push", "notification-click"],
    };
    const subject = createSubject({
      workerArtifactPaths: ["/sw.js", "/firebase-messaging-sw.js"],
      initialRegistrations: [legacyRegistration],
    });

    expect(
      await subject.initialize(iphoneLogin("member-1", "generation-1")),
    ).toEqual({ kind: "Failed", code: "WORKER_ARTIFACT_INVALID" });
    expect(subject.state().registrations).toEqual([legacyRegistration]);
    expect(subject.state().retiredRegistrationIds).toEqual([]);
  });

  it("[T-PWA-001][PWA-003] active root worker가 없으면 page·cache·push·click 기능을 성공으로 가장하지 않는다", () => {
    const subject = createSubject();

    expect(subject.requestPage("/expenses")).toEqual({ kind: "Unavailable" });
    expect(subject.fetchPublicAsset("/icons/icon-192.png")).toEqual({
      kind: "Unavailable",
    });
    expect(subject.receiveBackgroundPush("notification-1")).toEqual({
      kind: "WorkerUnavailable",
    });
    expect(
      subject.clickNotification("/expenses/transaction-1", true),
    ).toEqual({ kind: "Rejected", code: "WORKER_UNAVAILABLE" });
  });

  it.each(["/fonts/app.woff2", "/images/brand.webp"])(
    "[T-PWA-001/T-PWA-002][PWA-003/PWA-004] 단일 root worker는 allowlist의 공개 asset %s를 cache capability로 제공한다",
    async (path) => {
      const subject = createSubject();
      const initialized = await subject.initialize(
        iphoneLogin("member-1", "generation-1"),
      );
      if (initialized.kind !== "Ready") {
        throw new Error("production PWA가 Ready여야 합니다.");
      }

      expect(subject.fetchPublicAsset(path)).toEqual({
        kind: "CacheServed",
        registrationId: initialized.registrationId,
        path,
      });
    },
  );

  it.each([
    "/api/expenses",
    "/expenses",
    "/assets/asset-1",
    "/icons/unlisted.png",
    "/icons/icon-192.png?memberId=member-1",
    "https://external.example/icon.png",
  ])(
    "[T-PWA-001/T-PWA-002][PWA-003/PWA-004] 금융·API·navigation·미등록·외부 경로 %s는 public cache로 제공하지 않는다",
    async (path) => {
      const subject = createSubject();
      await subject.initialize(iphoneLogin("member-1", "generation-1"));

      expect(subject.fetchPublicAsset(path)).toEqual({ kind: "Unavailable" });
    },
  );

  it("[T-PWA-001][PWA-003/PWA-006] 일치하는 기존 client가 없으면 안전한 목적지를 새 창으로 연다", async () => {
    const subject = createSubject();
    const initialized = await subject.initialize(
      iphoneLogin("member-1", "generation-1"),
    );
    if (initialized.kind !== "Ready") {
      throw new Error("production PWA가 Ready여야 합니다.");
    }

    expect(
      subject.clickNotification("/assets/asset-1", false),
    ).toEqual({
      kind: "Opened",
      registrationId: initialized.registrationId,
      destination: "/assets/asset-1",
    });
  });

  it.each([
    "https://external.example/expenses/transaction-1",
    "//external.example/expenses/transaction-1",
    "/expenses/transaction-1?token=secret",
    "/expenses/transaction-1#detail",
    "/expenses/%252e%252e",
    "/expenses/transaction-1/edit",
    "/settings/member-1",
  ])(
    "[T-PWA-001/T-PWA-004][PWA-003/PWA-006] 안전한 구조화 route가 아닌 click 목적지 %s를 열지 않는다",
    async (destination) => {
      const subject = createSubject();
      await subject.initialize(iphoneLogin("member-1", "generation-1"));

      expect(subject.clickNotification(destination, false)).toEqual({
        kind: "Rejected",
        code: "DESTINATION_NOT_ALLOWED",
      });
    },
  );

  it.each(["https://external.example/page", "//external.example/page"])(
    "[T-PWA-001][PWA-003] root worker는 다른 origin의 page 요청 %s를 제공하지 않는다",
    async (path) => {
      const subject = createSubject();
      await subject.initialize(iphoneLogin("member-1", "generation-1"));

      expect(subject.requestPage(path)).toEqual({ kind: "Unavailable" });
    },
  );

  it("[T-PWA-001][PWA-003/PWA-008] waiting version이 active와 같으면 새 update로 잘못 보고하지 않는다", async () => {
    const subject = createSubject({
      activeWorkerVersion: "worker-v2",
      waitingWorkerVersion: "worker-v2",
    });

    expect(
      await subject.initialize({
        environment: "production",
        displayMode: "browser",
        deviceClass: "desktop",
      }),
    ).toMatchObject({ kind: "Ready", scope: "/" });
  });

  it("[T-PWA-001][PWA-001/PWA-003] development 초기화는 기존 root registration도 암묵적으로 폐기하지 않는다", async () => {
    const legacyRegistration: LegacyRootRegistrationFixture = {
      registrationId: "legacy-cache-worker",
      scope: "/",
      scriptUrl: "/sw.js",
      capabilities: ["page", "cache"],
    };
    const subject = createSubject({
      initialRegistrations: [legacyRegistration],
    });

    expect(
      await subject.initialize({
        environment: "development",
        displayMode: "browser",
        deviceClass: "desktop",
      }),
    ).toEqual({ kind: "DisabledInDevelopment" });
    expect(subject.state().registrations).toEqual([legacyRegistration]);
    expect(subject.state().retiredRegistrationIds).toEqual([]);
  });

  it("[T-PWA-001/T-PWA-002][PWA-003/PWA-004] 알림 endpoint가 없는 session도 logout 때 이전 generation을 purge한다", async () => {
    const subject = createSubject();
    await subject.initialize({
      environment: "production",
      displayMode: "browser",
      deviceClass: "desktop",
      authenticatedMemberId: "member-1",
      sessionGeneration: "generation-desktop",
    });

    expect(await subject.logout()).toEqual({
      kind: "LoggedOut",
      sessionGeneration: undefined,
    });
    expect(subject.state()).toMatchObject({
      sessionGeneration: undefined,
      sessionCleanup: "clean",
      endpointEvents: [
        { kind: "SessionPurged", previousGeneration: "generation-desktop" },
      ],
    });
  });
});
