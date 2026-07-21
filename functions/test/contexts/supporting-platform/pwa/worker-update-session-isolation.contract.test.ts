import { describe, expect, it } from "vitest";
import {
  createPwaWorkerSessionDriver,
  type AsyncSessionResult as SessionAsyncResult,
  type IncompatibleWriteOutcome as WriteOutcome,
  type PwaClientSnapshot as ClientSnapshot,
  type PwaWorkerRuntimeState as WorkerRuntimeState,
  type PwaWorkerSessionDriver,
  type PwaWorkerSessionFixture,
  type SessionPurgeOutcome as PurgeOutcome,
  type SessionReadAttempt as ReadAttempt,
  type WorkerUpdateOutcome as UpdateOutcome,
} from "../../../support/pwa-worker-session-driver";

export type PwaClientSnapshot = ClientSnapshot;
export type PwaWorkerRuntimeState = WorkerRuntimeState;
export type WorkerUpdateOutcome = UpdateOutcome;
export type SessionPurgeOutcome = PurgeOutcome;
export type AsyncSessionResult = SessionAsyncResult;
export type IncompatibleWriteOutcome = WriteOutcome;
export type SessionReadAttempt = ReadAttempt;

export interface PwaWorkerSessionContractSubject
  extends PwaWorkerSessionDriver {}

export function createSubject(
  fixture?: PwaWorkerSessionFixture,
): PwaWorkerSessionContractSubject {
  return createPwaWorkerSessionDriver(fixture);
}

describe("PWA worker update·SessionScope 격리 공개 계약", () => {
  it("[T-PWA-006][PWA-008] 필수 정적 asset 준비 실패는 설치 성공이나 waiting update로 노출하지 않는다", async () => {
    const subject = createSubject({
      activeWorkerVersion: "worker-v1",
      activeCacheVersion: "cache-v1",
      clients: [{ clientId: "client-A", unsavedInput: "" }],
    });

    expect(
      await subject.discoverWorker({
        workerVersion: "worker-v2",
        cacheVersion: "cache-v2",
        requiredAssetsPrepared: false,
        candidateCacheNamespace: "household-static-cache-v2-partial",
      }),
    ).toEqual({ kind: "InstallFailed", workerVersion: "worker-v2" });
    expect(subject.state()).toMatchObject({
      activeWorkerVersion: "worker-v1",
      waitingWorkerVersion: undefined,
    });
    expect(subject.state().cacheNamespaces).not.toContain(
      "household-static-cache-v2-partial",
    );
  });

  it("[T-PWA-006][PWA-008][DEC-051] 새 worker는 정적 asset 준비 뒤 waiting하고 열린 client를 즉시 장악하거나 reload하지 않는다", async () => {
    const subject = createSubject({
      activeWorkerVersion: "worker-v1",
      activeCacheVersion: "cache-v1",
      clients: [{ clientId: "client-A", unsavedInput: "수정 중인 메모" }],
    });

    expect(
      await subject.discoverWorker({
        workerVersion: "worker-v2",
        cacheVersion: "cache-v2",
        requiredAssetsPrepared: true,
      }),
    ).toEqual({ kind: "Waiting", workerVersion: "worker-v2" });
    expect(subject.state()).toMatchObject({
      activeWorkerVersion: "worker-v1",
      waitingWorkerVersion: "worker-v2",
      clients: [
        {
          clientId: "client-A",
          unsavedInput: "수정 중인 메모",
          reloadCount: 0,
        },
      ],
    });
  });

  it("[T-PWA-006][PWA-008][DEC-051] 미저장 입력이 있으면 사용자 갱신도 보류하고 입력을 유지한다", async () => {
    const subject = createSubject({
      clients: [{ clientId: "client-A", unsavedInput: "수정 중인 메모" }],
    });
    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });

    expect(await subject.requestRefresh("client-A", "worker-v2")).toEqual({
      kind: "DeferredForUnsavedInput",
      workerVersion: "worker-v2",
    });
    expect(subject.state().clients[0]).toMatchObject({
      unsavedInput: "수정 중인 메모",
      reloadCount: 0,
    });
    expect(subject.state().activeWorkerVersion).not.toBe("worker-v2");
  });

  it("[T-PWA-006][PWA-008][DEC-051] 입력이 없는 client의 명시적 갱신은 새 worker를 활성화하고 그 client만 한 번 reload한다", async () => {
    const subject = createSubject({
      activeWorkerVersion: "worker-v1",
      activeCacheVersion: "cache-v1",
      clients: [
        { clientId: "client-A", unsavedInput: "" },
        { clientId: "client-B", unsavedInput: "다른 화면 입력" },
      ],
      cacheNamespaces: [
        "household-static-cache-v1",
        "household-static-cache-v0",
        "household-public-runtime-v1",
      ],
    });
    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });

    expect(await subject.requestRefresh("client-A", "worker-v2")).toEqual({
      kind: "Activated",
      workerVersion: "worker-v2",
      reloadedClientId: "client-A",
    });
    expect(subject.state()).toMatchObject({
      activeWorkerVersion: "worker-v2",
      activeCacheVersion: "cache-v2",
      waitingWorkerVersion: undefined,
    });
    expect(
      subject.state().clients.find(({ clientId }) => clientId === "client-A"),
    ).toMatchObject({ unsavedInput: "", reloadCount: 1 });
    expect(
      subject.state().clients.find(({ clientId }) => clientId === "client-B"),
    ).toMatchObject({ unsavedInput: "다른 화면 입력", reloadCount: 0 });
    expect(subject.state().cacheNamespaces).not.toContain(
      "household-static-cache-v1",
    );
    expect(subject.state().cacheNamespaces).not.toContain(
      "household-static-cache-v0",
    );
    expect(subject.state().cacheNamespaces).toContain(
      "household-public-runtime-v1",
    );
    expect(await subject.requestRefresh("client-A", "worker-v2")).toEqual({
      kind: "NoWaitingWorker",
    });
    expect(
      subject.state().clients.find(({ clientId }) => clientId === "client-A"),
    ).toMatchObject({ reloadCount: 1 });
  });

  it("[T-PWA-006][PWA-008] 활성화 요청은 화면이 관찰한 정확한 waiting version에만 적용한다", async () => {
    const subject = createSubject({
      activeWorkerVersion: "worker-v1",
      clients: [{ clientId: "client-A", unsavedInput: "" }],
    });
    await subject.discoverWorker({
      workerVersion: "worker-v3",
      cacheVersion: "cache-v3",
      requiredAssetsPrepared: true,
    });

    expect(await subject.requestRefresh("client-A", "worker-v2")).toEqual({
      kind: "WaitingVersionMismatch",
      expectedWorkerVersion: "worker-v2",
      actualWaitingWorkerVersion: "worker-v3",
    });
    expect(subject.state()).toMatchObject({
      activeWorkerVersion: "worker-v1",
      waitingWorkerVersion: "worker-v3",
      clients: [expect.objectContaining({ reloadCount: 0 })],
    });
  });

  it("[T-PWA-006][PWA-008][DEC-051] waiting 시간이 길어져도 사용자 선택 없이 강제 활성화·reload하지 않는다", async () => {
    const subject = createSubject({
      activeWorkerVersion: "worker-v1",
      clients: [{ clientId: "client-A", unsavedInput: "수정 중" }],
    });
    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });

    expect(subject.elapseWithoutUserAction(30 * 24 * 60 * 60 * 1_000)).toEqual({
      kind: "Waiting",
      workerVersion: "worker-v2",
    });
    expect(subject.state()).toMatchObject({
      activeWorkerVersion: "worker-v1",
      waitingWorkerVersion: "worker-v2",
      clients: [
        expect.objectContaining({ unsavedInput: "수정 중", reloadCount: 0 }),
      ],
    });
  });

  it("[T-PWA-006][PWA-008][DEC-051] 모든 client가 닫힌 뒤 재실행하면 waiting version을 사용한다", async () => {
    const subject = createSubject({
      activeWorkerVersion: "worker-v1",
      clients: [{ clientId: "client-A", unsavedInput: "" }],
    });
    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });

    expect(await subject.closeClient("client-A")).toEqual({
      kind: "Activated",
      workerVersion: "worker-v2",
    });
    subject.reopenClient("client-B");

    expect(subject.state()).toMatchObject({
      activeWorkerVersion: "worker-v2",
      waitingWorkerVersion: undefined,
      clients: [{ clientId: "client-B", unsavedInput: "", reloadCount: 0 }],
    });
  });

  it("[T-PWA-006][PWA-008] UPDATE_REQUIRED는 비호환 write를 성공으로 위장하지 않고 미저장 입력을 보존한 채 갱신을 안내한다", () => {
    const subject = createSubject({
      clients: [{ clientId: "client-A", unsavedInput: "아직 저장하지 않은 값" }],
    });

    expect(subject.handleIncompatibleWrite("client-A")).toEqual({
      kind: "UpdateRequired",
      inputPreserved: true,
      reloadTriggered: false,
    });
    expect(subject.state().clients[0]).toMatchObject({
      unsavedInput: "아직 저장하지 않은 값",
      reloadCount: 0,
    });
  });

  it("[T-PWA-002][PWA-004] SessionScope 전환 뒤 이전 generation의 늦은 callback은 새 화면과 cache에 적용하지 않는다", async () => {
    const subject = createSubject({
      sessionGeneration: "generation-old",
      clients: [{ clientId: "client-A", unsavedInput: "" }],
    });
    const pending = subject.beginAsyncRead("client-A");

    expect(
      await subject.transitionSession({
        nextGeneration: "generation-new",
        purgeResult: "success",
        reason: "authenticated-user-change",
      }),
    ).toEqual({
      kind: "Purged",
      previousGeneration: "generation-old",
    });
    expect(
      subject.completeAsyncRead({
        callbackId: pending.callbackId,
        capturedGeneration: pending.sessionGeneration,
        marker: "old-household-finance-response",
      }),
    ).toEqual({ kind: "DiscardedStaleGeneration" });
    expect(subject.state()).toMatchObject({
      sessionGeneration: "generation-new",
      clients: [
        {
          clientId: "client-A",
          visibleDataMarker: undefined,
        },
      ],
    });
  });

  it("[T-PWA-002][PWA-004] 이전 generation purge 실패는 다음 session의 읽기를 열지 않고 격리 상태로 끝난다", async () => {
    const subject = createSubject({
      sessionGeneration: "generation-old",
      clients: [{ clientId: "client-A", unsavedInput: "" }],
    });

    expect(
      await subject.transitionSession({
        purgeResult: "failure",
        reason: "logout",
      }),
    ).toEqual({
      kind: "FailedAndIsolated",
      previousGeneration: "generation-old",
    });
    expect(subject.state().sessionGeneration).toBeUndefined();
    expect(subject.state().clients[0].visibleDataMarker).toBeUndefined();
    expect(subject.attemptSessionRead()).toEqual({
      kind: "Blocked",
      reason: "PREVIOUS_SESSION_CLEANUP_FAILED",
    });
  });

  it("[T-PWA-002][PWA-004] logout 성공은 next generation을 만들지 않고 request·subscription·화면·session cache를 모두 폐기한다", async () => {
    const subject = createSubject({
      sessionGeneration: "generation-old",
      clients: [
        {
          clientId: "client-A",
          unsavedInput: "",
          visibleDataMarker: "old-household-financial-response",
        },
      ],
      cacheNamespaces: [
        "session:generation-old:unexpected-financial-response",
        "household-public-runtime-v1",
      ],
    });
    const pending = subject.beginAsyncRead("client-A");
    const subscription = subject.subscribe("client-A");

    expect(
      await subject.transitionSession({ purgeResult: "success", reason: "logout" }),
    ).toEqual({ kind: "Purged", previousGeneration: "generation-old" });
    expect(subject.state()).toMatchObject({
      sessionGeneration: undefined,
      clients: [expect.objectContaining({ visibleDataMarker: undefined })],
      cacheNamespaces: ["household-public-runtime-v1"],
      securityViolationCodes: ["SESSION_DERIVED_CACHE_FOUND"],
      pendingRequestIds: [],
      subscriptionIds: [],
      sessionReadGate: "blocked-until-authentication",
    });
    expect(subject.state().pendingRequestIds).not.toContain(pending.callbackId);
    expect(subject.state().subscriptionIds).not.toContain(
      subscription.subscriptionId,
    );
    expect(subject.attemptSessionRead()).toEqual({
      kind: "Blocked",
      reason: "UNAUTHENTICATED",
    });
  });

  it.each(["authenticated-user-change", "household-change"] as const)(
    "[T-PWA-002][PWA-004] $reason 성공만 새 generation으로 열고 이전 request·subscription·cache를 제거한다",
    async (reason) => {
      const subject = createSubject({
        sessionGeneration: "generation-old",
        clients: [
          {
            clientId: "client-A",
            unsavedInput: "",
            visibleDataMarker: "old-household-financial-response",
          },
        ],
        cacheNamespaces: [
          "session:generation-old:unexpected-financial-response",
          "household-public-runtime-v1",
        ],
      });
      subject.beginAsyncRead("client-A");
      subject.subscribe("client-A");

      expect(
        await subject.transitionSession({
          nextGeneration: "generation-new",
          purgeResult: "success",
          reason,
        }),
      ).toEqual({
        kind: "Purged",
        previousGeneration: "generation-old",
      });
      expect(subject.state()).toMatchObject({
        sessionGeneration: "generation-new",
        clients: [expect.objectContaining({ visibleDataMarker: undefined })],
        cacheNamespaces: ["household-public-runtime-v1"],
        securityViolationCodes: ["SESSION_DERIVED_CACHE_FOUND"],
        pendingRequestIds: [],
        subscriptionIds: [],
        sessionReadGate: "open",
      });
      expect(subject.attemptSessionRead()).toEqual({
        kind: "Allowed",
        sessionGeneration: "generation-new",
      });
    },
  );

  it("[T-PWA-001/T-PWA-006][PWA-003/PWA-008] worker update는 같은 단일 root registration 안에서 version만 교체한다", async () => {
    const subject = createSubject({
      sessionGeneration: "generation-current",
      boundFid: "fid-current-installation",
      pendingMessageIds: ["message-current-session"],
      clients: [{ clientId: "client-A", unsavedInput: "" }],
    });
    const before = subject.state().rootRegistration;

    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });
    await subject.requestRefresh("client-A", "worker-v2");

    expect(subject.state()).toMatchObject({
      rootRegistration: before,
      activeWorkerVersion: "worker-v2",
      sessionGeneration: "generation-current",
      boundFid: "fid-current-installation",
      pendingMessageIds: ["message-current-session"],
    });
    expect(before).toMatchObject({
      scope: "/",
      scriptUrl: "/sw.js",
      capabilities: ["page", "cache", "push", "notification-click"],
    });
  });

  it.each([
    {
      name: "구 Firebase 전용 worker",
      rootRegistration: {
        registrationId: "legacy-firebase-worker",
        scope: "/" as const,
        scriptUrl: "/firebase-messaging-sw.js" as const,
        capabilities: ["push", "notification-click"] as const,
      },
    },
    {
      name: "push capability가 빠진 sw.js",
      rootRegistration: {
        registrationId: "incomplete-root-worker",
        scope: "/" as const,
        scriptUrl: "/sw.js" as const,
        capabilities: ["page", "cache", "notification-click"] as const,
      },
    },
  ])(
    "[T-PWA-001/T-PWA-006][PWA-003/PWA-008] $name 위에는 통합 update를 설치하지 않는다",
    async ({ rootRegistration }) => {
      const subject = createSubject({ rootRegistration });

      expect(
        await subject.discoverWorker({
          workerVersion: "worker-v2",
          cacheVersion: "cache-v2",
          requiredAssetsPrepared: true,
          candidateCacheNamespace: "household-static-cache-v2",
        }),
      ).toEqual({ kind: "InstallFailed", workerVersion: "worker-v2" });
      expect(subject.state()).toMatchObject({
        activeWorkerVersion: "worker-v1",
        waitingWorkerVersion: undefined,
      });
      expect(subject.state().cacheNamespaces).not.toContain(
        "household-static-cache-v2",
      );
    },
  );

  it("[T-PWA-006][PWA-008] 더 새로운 waiting worker가 준비되면 교체된 candidate cache를 남기지 않는다", async () => {
    const subject = createSubject({
      cacheNamespaces: ["household-public-runtime-v1"],
    });
    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });

    expect(
      await subject.discoverWorker({
        workerVersion: "worker-v3",
        cacheVersion: "cache-v3",
        requiredAssetsPrepared: true,
      }),
    ).toEqual({ kind: "Waiting", workerVersion: "worker-v3" });
    expect(subject.state()).toMatchObject({
      waitingWorkerVersion: "worker-v3",
      waitingCacheVersion: "cache-v3",
    });
    expect(subject.state().cacheNamespaces).toEqual([
      "household-public-runtime-v1",
      "household-static-cache-v3",
    ]);
  });

  it("[T-PWA-006][PWA-008] 다음 candidate 설치 실패는 이미 완전히 준비된 waiting worker를 폐기하지 않는다", async () => {
    const subject = createSubject();
    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });

    expect(
      await subject.discoverWorker({
        workerVersion: "worker-v3",
        cacheVersion: "cache-v3",
        requiredAssetsPrepared: false,
        candidateCacheNamespace: "household-static-cache-v3-partial",
      }),
    ).toEqual({ kind: "InstallFailed", workerVersion: "worker-v3" });
    expect(subject.state()).toMatchObject({
      waitingWorkerVersion: "worker-v2",
      waitingCacheVersion: "cache-v2",
    });
    expect(subject.state().cacheNamespaces).toContain(
      "household-static-cache-v2",
    );
    expect(subject.state().cacheNamespaces).not.toContain(
      "household-static-cache-v3-partial",
    );
  });

  it("[T-PWA-006][PWA-008] 활성화는 이 모듈의 구 static cache만 제거하고 public·session·타 모듈 namespace는 건드리지 않는다", async () => {
    const subject = createSubject({
      clients: [{ clientId: "client-A", unsavedInput: "" }],
      cacheNamespaces: [
        "household-static-cache-v1",
        "household-public-runtime-v1",
        "session:generation-current:unexpected",
        "another-module-cache-v1",
      ],
    });
    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });
    await subject.requestRefresh("client-A", "worker-v2");

    expect(subject.state().cacheNamespaces).toEqual([
      "household-public-runtime-v1",
      "session:generation-current:unexpected",
      "another-module-cache-v1",
      "household-static-cache-v2",
    ]);
  });

  it("[T-PWA-006][PWA-008][DEC-051] 여러 client 중 마지막 client가 닫힐 때만 waiting worker를 활성화한다", async () => {
    const subject = createSubject({
      clients: [
        { clientId: "client-A", unsavedInput: "수정 중" },
        { clientId: "client-B", unsavedInput: "다른 수정 중" },
      ],
    });
    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });

    expect(await subject.closeClient("client-A")).toEqual({
      kind: "Waiting",
      workerVersion: "worker-v2",
    });
    expect(subject.state().activeWorkerVersion).toBe("worker-v1");
    expect(await subject.closeClient("client-B")).toEqual({
      kind: "Activated",
      workerVersion: "worker-v2",
    });
    expect(subject.state().clients).toEqual([]);
  });

  it("[T-PWA-006][PWA-008][DEC-051] 미저장 입력을 저장한 뒤 같은 client가 명시적으로 갱신할 수 있다", async () => {
    const subject = createSubject({
      clients: [{ clientId: "client-A", unsavedInput: "수정 중" }],
    });
    await subject.discoverWorker({
      workerVersion: "worker-v2",
      cacheVersion: "cache-v2",
      requiredAssetsPrepared: true,
    });
    subject.updateClientInput("client-A", "");

    expect(await subject.requestRefresh("client-A", "worker-v2")).toEqual({
      kind: "Activated",
      workerVersion: "worker-v2",
      reloadedClientId: "client-A",
    });
  });

  it("[T-PWA-006][PWA-008] waiting worker가 없으면 시간 경과가 update를 만들어내지 않는다", () => {
    expect(createSubject().elapseWithoutUserAction(Number.MAX_SAFE_INTEGER)).toEqual({
      kind: "NoWaitingWorker",
    });
  });

  it("[T-PWA-002][PWA-004] 현재 generation에서 시작하고 완료된 callback만 화면에 적용한다", () => {
    const subject = createSubject({
      sessionGeneration: "generation-current",
      clients: [{ clientId: "client-A", unsavedInput: "" }],
    });
    const pending = subject.beginAsyncRead("client-A");

    expect(
      subject.completeAsyncRead({
        callbackId: pending.callbackId,
        capturedGeneration: pending.sessionGeneration,
        marker: "current-household-response",
      }),
    ).toEqual({ kind: "Applied", marker: "current-household-response" });
    expect(subject.state().clients[0].visibleDataMarker).toBe(
      "current-household-response",
    );
    expect(subject.state().pendingRequestIds).toEqual([]);
  });

  it.each([
    {
      reason: "logout" as const,
      input: { purgeResult: "success" as const, reason: "logout" as const },
      expectedGeneration: undefined,
      expectedGate: "blocked-until-authentication",
    },
    {
      reason: "authenticated-user-change" as const,
      input: {
        nextGeneration: "generation-new",
        purgeResult: "success" as const,
        reason: "authenticated-user-change" as const,
      },
      expectedGeneration: "generation-new",
      expectedGate: "open",
    },
    {
      reason: "household-change" as const,
      input: {
        nextGeneration: "generation-new",
        purgeResult: "success" as const,
        reason: "household-change" as const,
      },
      expectedGeneration: "generation-new",
      expectedGate: "open",
    },
  ])(
    "[T-PWA-001/T-PWA-002][PWA-003/PWA-004] $reason은 이전 session의 cache·FID·worker message를 다음 session으로 넘기지 않는다",
    async ({ input, expectedGeneration, expectedGate }) => {
      const subject = createSubject({
        sessionGeneration: "generation-old",
        boundFid: "fid-old-session",
        pendingMessageIds: ["message-old-1", "message-old-2"],
        cacheNamespaces: [
          "household-static-cache-v1",
          "household-public-runtime-v1",
          "session:generation-old:financial-response",
        ],
      });
      const rootRegistration = subject.state().rootRegistration;

      expect(await subject.transitionSession(input)).toEqual({
        kind: "Purged",
        previousGeneration: "generation-old",
      });
      expect(subject.state()).toMatchObject({
        rootRegistration,
        sessionGeneration: expectedGeneration,
        boundFid: undefined,
        pendingMessageIds: [],
        sessionReadGate: expectedGate,
        cacheNamespaces: [
          "household-static-cache-v1",
          "household-public-runtime-v1",
        ],
        securityViolationCodes: ["SESSION_DERIVED_CACHE_FOUND"],
      });
    },
  );

  it("[T-PWA-001/T-PWA-002][PWA-003/PWA-004] purge 실패도 이전 FID·message·callback을 격리하고 요청한 새 generation을 열지 않는다", async () => {
    const subject = createSubject({
      sessionGeneration: "generation-old",
      boundFid: "fid-old-session",
      pendingMessageIds: ["message-old"],
      clients: [{ clientId: "client-A", unsavedInput: "" }],
    });
    const pending = subject.beginAsyncRead("client-A");

    expect(
      await subject.transitionSession({
        nextGeneration: "generation-new",
        purgeResult: "failure",
        reason: "authenticated-user-change",
      }),
    ).toEqual({
      kind: "FailedAndIsolated",
      previousGeneration: "generation-old",
    });
    expect(subject.state()).toMatchObject({
      sessionGeneration: undefined,
      boundFid: undefined,
      pendingMessageIds: [],
      pendingRequestIds: [],
      sessionReadGate: "blocked-cleanup-failed",
    });
    expect(
      subject.completeAsyncRead({
        callbackId: pending.callbackId,
        capturedGeneration: pending.sessionGeneration,
        marker: "late-old-response",
      }),
    ).toEqual({ kind: "DiscardedStaleGeneration" });
  });

  it("[T-PWA-002][PWA-004] 새 generation이 열린 뒤 새로 시작한 callback만 적용된다", async () => {
    const subject = createSubject({
      sessionGeneration: "generation-old",
      clients: [{ clientId: "client-A", unsavedInput: "" }],
    });
    await subject.transitionSession({
      nextGeneration: "generation-new",
      purgeResult: "success",
      reason: "household-change",
    });
    const current = subject.beginAsyncRead("client-A");

    expect(
      subject.completeAsyncRead({
        callbackId: current.callbackId,
        capturedGeneration: current.sessionGeneration,
        marker: "new-household-response",
      }),
    ).toEqual({ kind: "Applied", marker: "new-household-response" });
    expect(subject.state().clients[0].visibleDataMarker).toBe(
      "new-household-response",
    );
  });

  it("[T-PWA-002][PWA-004] session namespace와 이름이 비슷할 뿐인 다른 cache는 오탐으로 삭제하지 않는다", async () => {
    const subject = createSubject({
      sessionGeneration: "generation-old",
      cacheNamespaces: [
        "session:generation-old:financial-response",
        "sessionless-public-metadata",
        "household-public-runtime-v1",
      ],
    });

    await subject.transitionSession({ purgeResult: "success", reason: "logout" });

    expect(subject.state().cacheNamespaces).toEqual([
      "sessionless-public-metadata",
      "household-public-runtime-v1",
    ]);
  });
});
