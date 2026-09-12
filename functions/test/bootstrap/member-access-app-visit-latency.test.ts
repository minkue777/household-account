import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { createMemberAccessHouseholdCommandHandlers } from "../../src/bootstrap/commands/memberAccessHouseholdCommandHandlers";
import type {
  HouseholdCommandExecutionContext,
  HouseholdCommandHandler,
} from "../../src/bootstrap/commands/householdCommand";

function context(
  payload: Readonly<Record<string, unknown>>,
): HouseholdCommandExecutionContext {
  return {
    principalUid: "uid-sensitive",
    actor: {
      principalUid: "uid-sensitive",
      householdId: "household-sensitive",
      actingMemberId: "member-sensitive",
      capabilities: ["household.read"],
    },
    envelope: {
      contractVersion: "household-command.v1",
      command: "access.record-app-visit.v1",
      commandId: "app-visit-1",
      idempotencyKey: "app-visit-1",
      householdId: "household-sensitive",
      payload,
    },
    requestedAt: "2026-07-30T00:00:00.000Z",
  };
}

function handler(dependencies: Parameters<
  typeof createMemberAccessHouseholdCommandHandlers
>[1]): HouseholdCommandHandler {
  return new Map(
    createMemberAccessHouseholdCommandHandlers(
      {} as firestore.Firestore,
      dependencies,
    ),
  ).get("access.record-app-visit.v1")!;
}

describe("member app visit startup latency", () => {
  it.each([
    [
      "android",
      "client.android-app-first-home-complete-paint.v1",
    ],
    [
      "ios-pwa",
      "client.ios-pwa-first-home-complete-paint.v1",
    ],
  ] as const)(
    "%s 첫 화면 전체 표시 시간을 PII 없는 clientStartup 표본으로 기록한다",
    async (platform, operation) => {
      const recordAccess = vi.fn(async () => ({
        kind: "recorded" as const,
        totalAccessCount: 3,
      }));
      const recordLatency = vi.fn();
      const subject = handler({ recordAccess, recordLatency });

      await expect(subject.execute(context({
        visitId: "app-visit-1",
        platform,
        clientStartupDurationMs: 3_245.6784,
      }))).resolves.toEqual({
        kind: "recorded",
        totalAccessCount: 3,
      });

      expect(recordLatency).toHaveBeenCalledWith({
        endpoint: "clientStartup",
        operation,
        elapsedMs: 3_245.678,
        status: "succeeded",
      });
      expect(JSON.stringify(recordLatency.mock.calls)).not.toMatch(
        /uid-sensitive|household-sensitive|member-sensitive/u,
      );
    },
  );

  it("구버전 payload와 재전송은 접속을 보존하면서 지연 표본을 중복 생성하지 않는다", async () => {
    const recordAccess = vi.fn()
      .mockResolvedValueOnce({
        kind: "recorded" as const,
        totalAccessCount: 1,
      })
      .mockResolvedValueOnce({
        kind: "already-recorded" as const,
        totalAccessCount: 1,
      });
    const recordLatency = vi.fn();
    const subject = handler({ recordAccess, recordLatency });

    await subject.execute(context({
      visitId: "app-visit-1",
      platform: "android",
    }));
    await subject.execute(context({
      visitId: "app-visit-1",
      platform: "android",
      clientStartupDurationMs: 2_000,
    }));

    expect(recordAccess).toHaveBeenCalledTimes(2);
    expect(recordLatency).not.toHaveBeenCalled();
  });

  it("[T-ADM-004] Navigation 기준의 15개 단계 시각을 총시간과 같은 표본에 기록한다", async () => {
    const recordAccess = vi.fn(async () => ({
      kind: "recorded" as const,
      totalAccessCount: 1,
    }));
    const recordLatency = vi.fn();
    const timingsMs = {
      navigationResponseEnd: 0,
      bootstrapStarted: 100.1234,
      authStarted: 110,
      authReady: 300,
      membershipStarted: 310,
      membershipReady: 500,
      sessionReady: 510,
      ledgerRequested: 520,
      ledgerReady: 1_500,
      categoriesRequested: 530,
      categoriesReady: 1_200,
      localCurrencyRequested: 540,
      localCurrencyReady: 1_900,
      firstLedgerPaint: 1_520,
      firstHomeCompletePaint: 120_000,
    };

    await handler({ recordAccess, recordLatency }).execute(context({
      visitId: "app-visit-1",
      platform: "ios-pwa",
      clientStartupDurationMs: 120_000,
      clientStartupTimingsMs: timingsMs,
    }));

    expect(recordLatency).toHaveBeenCalledExactlyOnceWith({
      endpoint: "clientStartup",
      operation: "client.ios-pwa-first-home-complete-paint.v1",
      elapsedMs: 120_000,
      status: "succeeded",
      clientStartupTimingsMs: { ...timingsMs, bootstrapStarted: 100.123 },
    });
    expect(recordAccess).toHaveBeenCalledExactlyOnceWith({
      householdId: "household-sensitive",
      memberId: "member-sensitive",
      visitId: "app-visit-1",
      platform: "ios-pwa",
      accessedAt: "2026-07-30T00:00:00.000Z",
    });
  });

  it.each([
    ["알 수 없는 키", { url: 100 }],
    ["식별자 키", { householdId: 100 }],
    ["음수", { authReady: -1 }],
    ["2분 초과", { authReady: 120_001 }],
    ["문자열", { authReady: "100" }],
    ["NaN", { authReady: NaN }],
    ["무한대", { authReady: Infinity }],
    ["배열", [100]],
    ["null", null],
    ["16개 키", Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`key${i}`, i]))],
  ])("[T-ADM-004] %s 단계 시각을 기록 전에 거부한다", async (_label, timingsMs) => {
    const recordAccess = vi.fn();
    const recordLatency = vi.fn();
    await expect(handler({ recordAccess, recordLatency }).execute(context({
      visitId: "app-visit-1",
      platform: "ios-pwa",
      clientStartupDurationMs: 2_000,
      clientStartupTimingsMs: timingsMs,
    }))).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(recordAccess).not.toHaveBeenCalled();
    expect(recordLatency).not.toHaveBeenCalled();
  });

  it.each([
    { platform: "ios-pwa" },
    { platform: "web", clientStartupDurationMs: 2_000 },
  ])("[T-ADM-004] 유효한 모바일 총시간 없는 단계 표본을 거부한다: %j", async (payload) => {
    const recordAccess = vi.fn();
    await expect(handler({ recordAccess }).execute(context({
      visitId: "app-visit-1",
      ...payload,
      clientStartupTimingsMs: { authReady: 100 },
    }))).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(recordAccess).not.toHaveBeenCalled();
  });

  it.each([
    ["일반 Web 표본", { platform: "web", clientStartupDurationMs: 1_000 }],
    ["음수", { platform: "android", clientStartupDurationMs: -1 }],
    ["범위 초과", { platform: "android", clientStartupDurationMs: 120_001 }],
    ["무한대", { platform: "android", clientStartupDurationMs: Infinity }],
    ["추가 필드", { platform: "android", unexpected: true }],
  ])("%s payload를 거부한다", async (_label, candidate) => {
    const recordAccess = vi.fn(async () => ({
      kind: "recorded" as const,
      totalAccessCount: 1,
    }));
    const subject = handler({ recordAccess, recordLatency: vi.fn() });

    await expect(subject.execute(context({
      visitId: "app-visit-1",
      ...candidate,
    }))).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(recordAccess).not.toHaveBeenCalled();
  });

  it("지연 로그 출력 실패가 완료된 접속 기록을 실패로 바꾸지 않는다", async () => {
    const subject = handler({
      recordAccess: async () => ({
        kind: "recorded",
        totalAccessCount: 1,
      }),
      recordLatency() {
        throw new Error("LOG_UNAVAILABLE");
      },
    });

    await expect(subject.execute(context({
      visitId: "app-visit-1",
      platform: "ios-pwa",
      clientStartupDurationMs: 2_000,
    }))).resolves.toEqual({
      kind: "recorded",
      totalAccessCount: 1,
    });
  });
});
