import { describe, expect, it } from "vitest";

import {
  decideDividendProviderRunHealth,
  type DividendProviderRunCounts,
  type PreviousDividendProviderHealth,
} from "../../src/contexts/portfolio/dividends/domain/policies/dividendProviderRunHealthPolicy";

const partial: DividendProviderRunCounts = {
  success: 10,
  noData: 2,
  retryableFailure: 1,
  contractFailure: 1,
};

function previous(
  overrides: Partial<PreviousDividendProviderHealth> = {},
): PreviousDividendProviderHealth {
  return {
    lastAttemptAt: "2026-08-01T10:00:00+09:00",
    lastSuccessAt: "2026-08-01T10:00:00+09:00",
    consecutiveFailedRuns: 0,
    alertState: "closed",
    version: 10,
    ...overrides,
  };
}

describe("KIND 실행 단위 Health 정책", () => {
  it("일부 종목 실패는 장애가 아니라 degraded이며 경보와 연속 전체 실패를 만들지 않는다", () => {
    expect(
      decideDividendProviderRunHealth({
        observedAt: "2026-08-01T11:00:00+09:00",
        counts: partial,
        lastErrorCode: "HTTP_STATUS_NOT_SUPPORTED",
        previous: previous(),
      }),
    ).toEqual({
      kind: "updated",
      health: {
        status: "degraded",
        lastAttemptAt: "2026-08-01T11:00:00+09:00",
        lastSuccessAt: "2026-08-01T11:00:00+09:00",
        consecutiveFailedRuns: 0,
        lastResultKind: "PARTIAL_FAILURE",
        lastErrorCode: "HTTP_STATUS_NOT_SUPPORTED",
        alertState: "closed",
        lastRunTargetCount: 14,
        lastRunSucceededTargets: 12,
        lastRunFailedTargets: 2,
        version: 11,
      },
    });
  });

  it("모든 종목이 실패한 실행이 세 번 연속되어야 장애를 연다", () => {
    const counts: DividendProviderRunCounts = {
      success: 0,
      noData: 0,
      retryableFailure: 0,
      contractFailure: 14,
    };
    const first = decideDividendProviderRunHealth({
      observedAt: "2026-08-01T11:00:00+09:00",
      counts,
      lastErrorCode: "HTTP_STATUS_NOT_SUPPORTED",
      previous: previous(),
    });
    expect(first).toMatchObject({
      kind: "updated",
      health: {
        status: "degraded",
        consecutiveFailedRuns: 1,
        alertState: "closed",
      },
    });
    if (first.kind !== "updated") throw new Error("expected update");

    const second = decideDividendProviderRunHealth({
      observedAt: "2026-08-01T12:00:00+09:00",
      counts,
      lastErrorCode: "HTTP_STATUS_NOT_SUPPORTED",
      previous: first.health,
    });
    expect(second).toMatchObject({
      kind: "updated",
      health: {
        status: "degraded",
        consecutiveFailedRuns: 2,
        alertState: "closed",
      },
    });
    if (second.kind !== "updated") throw new Error("expected update");

    expect(
      decideDividendProviderRunHealth({
        observedAt: "2026-08-01T13:00:00+09:00",
        counts,
        lastErrorCode: "HTTP_STATUS_NOT_SUPPORTED",
        previous: second.health,
      }),
    ).toMatchObject({
      kind: "updated",
      alertTransition: "opened",
      health: {
        status: "outage",
        consecutiveFailedRuns: 3,
        alertState: "open",
      },
    });
  });

  it("장애 이후 일부라도 성공하면 경보를 닫되 부분 실패 상태를 유지한다", () => {
    expect(
      decideDividendProviderRunHealth({
        observedAt: "2026-08-02T09:00:00+09:00",
        counts: partial,
        lastErrorCode: "HTTP_STATUS_NOT_SUPPORTED",
        previous: previous({
          consecutiveFailedRuns: 3,
          failureStartedAt: "2026-08-01T11:00:00+09:00",
          alertState: "open",
        }),
      }),
    ).toMatchObject({
      kind: "updated",
      alertTransition: "resolved",
      health: {
        status: "degraded",
        consecutiveFailedRuns: 0,
        alertState: "closed",
        recoveredAt: "2026-08-02T09:00:00+09:00",
      },
    });
  });

  it("조회 대상이 없으면 기존 공급자 상태를 변경하지 않는다", () => {
    expect(
      decideDividendProviderRunHealth({
        observedAt: "2026-08-02T09:00:00+09:00",
        counts: {
          success: 0,
          noData: 0,
          retryableFailure: 0,
          contractFailure: 0,
        },
        previous: previous(),
      }),
    ).toEqual({ kind: "ignored", reason: "NO_PROVIDER_TARGETS" });
  });
});
