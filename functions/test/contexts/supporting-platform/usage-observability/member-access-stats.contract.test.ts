import { describe, expect, it } from "vitest";

import {
  emptyMemberAccessStats,
  recordMemberAccess,
  seoulCalendarDate,
  type MemberAccessEvent,
  type MemberAccessStats,
  type MemberAccessUpdate,
} from "../../../../src/platform/usage-observability/public";

export interface MemberAccessStatsSubject {
  empty(householdId: string, memberId: string): MemberAccessStats;
  record(
    current: MemberAccessStats,
    event: MemberAccessEvent,
  ): MemberAccessUpdate;
  seoulDate(instant: string): string;
}

export function createSubject(): MemberAccessStatsSubject {
  return {
    empty: emptyMemberAccessStats,
    record: recordMemberAccess,
    seoulDate: seoulCalendarDate,
  };
}

describe("사용자 앱 접속 집계 계약", () => {
  // ADM-006, T-ADM-005
  it("앱 실행을 서울 날짜·플랫폼·누적 횟수에 한 번 반영한다", () => {
    const subject = createSubject();
    const update = subject.record(
      subject.empty("household-1", "member-1"),
      {
        householdId: "household-1",
        memberId: "member-1",
        visitId: "app-visit-1",
        platform: "android",
        accessedAt: "2026-07-23T15:10:00.000Z",
      },
    );

    expect(subject.seoulDate("2026-07-23T15:10:00.000Z")).toBe("2026-07-24");
    expect(update).toMatchObject({
      replayed: false,
      stats: {
        totalAccessCount: 1,
        lastAccessAt: "2026-07-23T15:10:00.000Z",
        platformCounts: { android: 1, "ios-pwa": 0, web: 0 },
        dailyAccessCounts: { "2026-07-24": 1 },
        recentVisitIds: ["app-visit-1"],
      },
    });
  });

  it("같은 visitId 재전송은 접속 횟수를 중복 증가시키지 않는다", () => {
    const subject = createSubject();
    const first = subject.record(
      subject.empty("household-1", "member-1"),
      {
        householdId: "household-1",
        memberId: "member-1",
        visitId: "app-visit-1",
        platform: "ios-pwa",
        accessedAt: "2026-07-24T00:00:00.000Z",
      },
    );
    const replay = subject.record(first.stats, {
      householdId: "household-1",
      memberId: "member-1",
      visitId: "app-visit-1",
      platform: "ios-pwa",
      accessedAt: "2026-07-24T00:01:00.000Z",
    });

    expect(replay.replayed).toBe(true);
    expect(replay.stats).toEqual(first.stats);
  });

  it("일별 상세 집계는 최근 30일만 남기고 누적 횟수는 보존한다", () => {
    const subject = createSubject();
    const update = subject.record(
      {
        ...subject.empty("household-1", "member-1"),
        totalAccessCount: 9,
        dailyAccessCounts: {
          "2026-06-01": 3,
          "2026-07-01": 2,
          "2026-07-24": 4,
        },
      },
      {
        householdId: "household-1",
        memberId: "member-1",
        visitId: "app-visit-10",
        platform: "web",
        accessedAt: "2026-07-24T03:00:00.000Z",
      },
    );

    expect(update.stats.totalAccessCount).toBe(10);
    expect(update.stats.dailyAccessCounts).toEqual({
      "2026-07-01": 2,
      "2026-07-24": 5,
    });
  });

  it("다른 가구원 범위의 통계를 섞지 않는다", () => {
    const subject = createSubject();
    expect(() =>
      subject.record(
        subject.empty("household-1", "member-1"),
        {
          householdId: "household-2",
          memberId: "member-1",
          visitId: "app-visit-1",
          platform: "web",
          accessedAt: "2026-07-24T00:00:00.000Z",
        },
      ),
    ).toThrow("ACCESS_STATS_SCOPE_MISMATCH");
  });
});
