import type { HouseholdCommandResults } from '@/platform/functions-api/householdCommandContract';

export type SignedInUserResolution =
  HouseholdCommandResults['access.resolve-signed-in-user.v1'];
export type MembershipFoundResolution = Extract<
  SignedInUserResolution,
  { kind: 'membership-found' }
>;

const STORAGE_KEY = 'household-account.signed-in-membership.v1';

interface StoredMembership {
  version: 1 | 2 | 3 | 4 | 5;
  principalUid: string;
  resolution: MembershipFoundResolution;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeHousehold(
  value: unknown,
  householdId: string
): MembershipFoundResolution['household'] {
  if (
    !isRecord(value)
    || value.id !== householdId
    || typeof value.name !== 'string'
    || value.name.trim() === ''
    || typeof value.createdAt !== 'string'
    || Number.isNaN(Date.parse(value.createdAt))
    || !Array.isArray(value.members)
  ) {
    return undefined;
  }

  const members = value.members.map((candidate) => {
    if (
      !isRecord(candidate)
      || typeof candidate.id !== 'string'
      || candidate.id.trim() === ''
      || typeof candidate.name !== 'string'
      || candidate.name.trim() === ''
      || !Number.isInteger(candidate.aggregateVersion)
      || Number(candidate.aggregateVersion) < 1
    ) {
      return undefined;
    }
    return {
      id: candidate.id,
      name: candidate.name,
      aggregateVersion: Number(candidate.aggregateVersion),
    };
  });
  if (members.some((member) => member === undefined)) return undefined;

  const rawSummary = value.homeSummaryConfig;
  const homeSummaryConfig =
    isRecord(rawSummary)
    && typeof rawSummary.leftCard === 'string'
    && typeof rawSummary.rightCard === 'string'
      ? {
          leftCard: rawSummary.leftCard,
          rightCard: rawSummary.rightCard,
        }
      : undefined;

  return {
    id: householdId,
    name: value.name,
    createdAt: value.createdAt,
    ...(typeof value.defaultCategoryKey === 'string'
      ? { defaultCategoryKey: value.defaultCategoryKey }
      : {}),
    ...(homeSummaryConfig ? { homeSummaryConfig } : {}),
    members: members as NonNullable<MembershipFoundResolution['household']>['members'],
  };
}

function decode(value: unknown): StoredMembership | undefined {
  if (
    !isRecord(value)
    || (
      value.version !== 1
      && value.version !== 2
      && value.version !== 3
      && value.version !== 4
      && value.version !== 5
    )
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
  const household = decodeHousehold(resolution.household, membership.householdId);
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
      ...(household ? { household } : {}),
    },
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
 * 이 값은 반복 인증 왕복을 줄이는 연결 hint일 뿐 화면 데이터가 아니며,
 * Firestore rules와 Functions가 모든 실제 read/write 권한을 다시 검증합니다.
 */
export function readSignedInMembershipCache(
  principalUid: string
): MembershipFoundResolution | undefined {
  if (typeof window === 'undefined' || principalUid.trim() === '') return undefined;
  const stored = readStoredMembership();
  return stored?.principalUid === principalUid ? stored.resolution : undefined;
}

/** 금융 화면 데이터 없이 인증된 Membership scope와 가구 표시 설정만 보존합니다. */
export function writeSignedInMembershipCache(
  principalUid: string,
  resolution: MembershipFoundResolution
): void {
  if (typeof window === 'undefined' || principalUid.trim() === '') return;
  const stored: StoredMembership = {
    version: 5,
    principalUid,
    resolution,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearSignedInMembershipCache(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
