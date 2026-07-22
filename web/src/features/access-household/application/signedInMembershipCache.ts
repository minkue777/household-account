import type { HouseholdCommandResults } from '@/platform/functions-api/householdCommandContract';
import {
  type HomeSummaryCardKey,
  type Household,
} from '@/types/household';

export type SignedInUserResolution =
  HouseholdCommandResults['access.resolve-signed-in-user.v1'];
export type MembershipFoundResolution = Extract<
  SignedInUserResolution,
  { kind: 'membership-found' }
>;

const STORAGE_KEY = 'household-account.signed-in-membership.v1';

interface StoredMembership {
  version: 1 | 2;
  principalUid: string;
  resolution: MembershipFoundResolution;
  household?: StoredHousehold;
}

interface StoredHousehold {
  id: string;
  name: string;
  createdAt: string;
  defaultCategoryKey?: string;
  homeSummaryConfig?: {
    leftCard: HomeSummaryCardKey;
    rightCard: HomeSummaryCardKey;
  };
  members: Array<{
    id: string;
    name: string;
    aggregateVersion: number;
  }>;
}

const HOME_SUMMARY_CARD_KEYS = new Set<HomeSummaryCardKey>([
  'localCurrencyBalance',
  'monthlyRemainingBudget',
  'monthlySpent',
  'yearlySpent',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeStoredHousehold(value: unknown): StoredHousehold | undefined {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || value.id.trim() === ''
    || typeof value.name !== 'string'
    || typeof value.createdAt !== 'string'
    || Number.isNaN(Date.parse(value.createdAt))
    || !Array.isArray(value.members)
  ) {
    return undefined;
  }
  const members = value.members.map((member) => {
    if (
      !isRecord(member)
      || typeof member.id !== 'string'
      || member.id.trim() === ''
      || typeof member.name !== 'string'
      || !Number.isInteger(member.aggregateVersion)
      || Number(member.aggregateVersion) < 1
    ) {
      return undefined;
    }
    return {
      id: member.id,
      name: member.name,
      aggregateVersion: Number(member.aggregateVersion),
    };
  });
  if (members.some((member) => member === undefined)) return undefined;

  const rawSummary = value.homeSummaryConfig;
  const homeSummaryConfig = isRecord(rawSummary)
    && HOME_SUMMARY_CARD_KEYS.has(rawSummary.leftCard as HomeSummaryCardKey)
    && HOME_SUMMARY_CARD_KEYS.has(rawSummary.rightCard as HomeSummaryCardKey)
    ? {
        leftCard: rawSummary.leftCard as HomeSummaryCardKey,
        rightCard: rawSummary.rightCard as HomeSummaryCardKey,
      }
    : undefined;

  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    ...(typeof value.defaultCategoryKey === 'string'
      ? { defaultCategoryKey: value.defaultCategoryKey }
      : {}),
    ...(homeSummaryConfig ? { homeSummaryConfig } : {}),
    members: members as StoredHousehold['members'],
  };
}

function decode(value: unknown): StoredMembership | undefined {
  if (
    !isRecord(value)
    || (value.version !== 1 && value.version !== 2)
    || typeof value.principalUid !== 'string'
  ) {
    return undefined;
  }
  const resolution = value.resolution;
  if (!isRecord(resolution) || resolution.kind !== 'membership-found') return undefined;
  const membership = resolution.membership;
  if (
    !isRecord(membership)
    || typeof membership.householdId !== 'string'
    || membership.householdId.trim() === ''
    || typeof membership.memberId !== 'string'
    || membership.memberId.trim() === ''
    || typeof membership.displayName !== 'string'
    || membership.displayName.trim() === ''
    || !Number.isInteger(membership.aggregateVersion)
    || Number(membership.aggregateVersion) < 1
    || membership.status !== 'active'
    || !Array.isArray(membership.capabilities)
    || membership.capabilities.some((capability) => typeof capability !== 'string')
  ) {
    return undefined;
  }
  const household = decodeStoredHousehold(value.household);
  return {
    version: value.version,
    principalUid: value.principalUid,
    resolution: {
      kind: 'membership-found',
      membership: {
        householdId: membership.householdId,
        memberId: membership.memberId,
        displayName: membership.displayName,
        aggregateVersion: Number(membership.aggregateVersion),
        status: 'active',
        capabilities: [...membership.capabilities] as string[],
      },
    },
    ...(household ? { household } : {}),
  };
}

function serializeHousehold(household: Household): StoredHousehold {
  return {
    id: household.id,
    name: household.name,
    createdAt: household.createdAt.toISOString(),
    ...(household.defaultCategoryKey !== undefined
      ? { defaultCategoryKey: household.defaultCategoryKey }
      : {}),
    ...(household.homeSummaryConfig
      ? { homeSummaryConfig: { ...household.homeSummaryConfig } }
      : {}),
    members: household.members.map((member) => ({ ...member })),
  };
}

function readStoredMembership(): StoredMembership | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? decode(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Firebase Auth가 복원한 동일 principal의 마지막 검증 Membership을 읽습니다.
 * 이 값은 첫 화면을 여는 cache hint일 뿐이며 Firestore rules와 Functions가
 * 모든 실제 read/write 권한을 다시 검증합니다.
 */
export function readSignedInMembershipCache(
  principalUid: string
): MembershipFoundResolution | undefined {
  if (typeof window === 'undefined' || principalUid.trim() === '') return undefined;
  const stored = readStoredMembership();
  return stored?.principalUid === principalUid ? stored.resolution : undefined;
}

/**
 * 마지막으로 표시한 가구 read model을 동기식 localStorage에서 복원합니다.
 * 화면 선표시 전용이며 Firestore/Functions 권한 판정에는 사용하지 않습니다.
 */
export function readSignedInHouseholdCache(
  principalUid: string,
  householdId: string
): Household | undefined {
  if (principalUid.trim() === '' || householdId.trim() === '') return undefined;
  const stored = readStoredMembership();
  if (
    stored?.principalUid !== principalUid
    || stored.resolution.membership.householdId !== householdId
    || stored.household?.id !== householdId
  ) {
    return undefined;
  }
  const household = stored.household;
  return {
    id: household.id,
    name: household.name,
    createdAt: new Date(household.createdAt),
    ...(household.defaultCategoryKey !== undefined
      ? { defaultCategoryKey: household.defaultCategoryKey }
      : {}),
    ...(household.homeSummaryConfig
      ? { homeSummaryConfig: { ...household.homeSummaryConfig } }
      : {}),
    members: household.members.map((member) => ({ ...member })),
  };
}

export function writeSignedInMembershipCache(
  principalUid: string,
  resolution: MembershipFoundResolution,
  household?: Household
): void {
  if (typeof window === 'undefined' || principalUid.trim() === '') return;
  const current = readStoredMembership();
  const retainedHousehold = household
    ? serializeHousehold(household)
    : (
      current?.principalUid === principalUid
      && current.resolution.membership.householdId === resolution.membership.householdId
        ? current.household
        : undefined
    );
  const stored: StoredMembership = {
    version: 2,
    principalUid,
    resolution,
    ...(retainedHousehold ? { household: retainedHousehold } : {}),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearSignedInMembershipCache(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
