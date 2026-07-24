export type MemberAccessPlatform = "android" | "ios-pwa" | "web";

export interface MemberAccessStats {
  readonly householdId: string;
  readonly memberId: string;
  readonly totalAccessCount: number;
  readonly lastAccessAt?: string;
  readonly platformCounts: Readonly<Record<MemberAccessPlatform, number>>;
  readonly dailyAccessCounts: Readonly<Record<string, number>>;
  readonly recentVisitIds: readonly string[];
}

export interface MemberAccessEvent {
  readonly householdId: string;
  readonly memberId: string;
  readonly visitId: string;
  readonly platform: MemberAccessPlatform;
  readonly accessedAt: string;
}

export interface MemberAccessUpdate {
  readonly replayed: boolean;
  readonly stats: MemberAccessStats;
}

const RETAINED_DAYS = 30;
const RETAINED_VISIT_IDS = 128;

export function seoulCalendarDate(instant: string): string {
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp)) throw new Error("ACCESS_INSTANT_INVALID");
  return new Date(timestamp + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function retainedDateFloor(today: string): string {
  const timestamp = Date.parse(`${today}T00:00:00.000Z`);
  return new Date(timestamp - (RETAINED_DAYS - 1) * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

export function emptyMemberAccessStats(
  householdId: string,
  memberId: string,
): MemberAccessStats {
  return {
    householdId,
    memberId,
    totalAccessCount: 0,
    platformCounts: { android: 0, "ios-pwa": 0, web: 0 },
    dailyAccessCounts: {},
    recentVisitIds: [],
  };
}

export function recordMemberAccess(
  current: MemberAccessStats,
  event: MemberAccessEvent,
): MemberAccessUpdate {
  if (
    current.householdId !== event.householdId ||
    current.memberId !== event.memberId
  ) {
    throw new Error("ACCESS_STATS_SCOPE_MISMATCH");
  }
  if (current.recentVisitIds.includes(event.visitId)) {
    return { replayed: true, stats: current };
  }

  const today = seoulCalendarDate(event.accessedAt);
  const floor = retainedDateFloor(today);
  const dailyAccessCounts = Object.fromEntries(
    Object.entries(current.dailyAccessCounts).filter(
      ([date, count]) =>
        /^\d{4}-\d{2}-\d{2}$/u.test(date) &&
        date >= floor &&
        Number.isSafeInteger(count) &&
        count > 0,
    ),
  );
  dailyAccessCounts[today] = (dailyAccessCounts[today] ?? 0) + 1;

  return {
    replayed: false,
    stats: {
      ...current,
      totalAccessCount: current.totalAccessCount + 1,
      lastAccessAt: event.accessedAt,
      platformCounts: {
        ...current.platformCounts,
        [event.platform]: current.platformCounts[event.platform] + 1,
      },
      dailyAccessCounts,
      recentVisitIds: [event.visitId, ...current.recentVisitIds]
        .slice(0, RETAINED_VISIT_IDS),
    },
  };
}
