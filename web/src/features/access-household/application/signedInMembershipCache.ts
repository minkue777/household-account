import type { HouseholdCommandResults } from '@/platform/functions-api/householdCommandContract';

export type SignedInUserResolution =
  HouseholdCommandResults['access.resolve-signed-in-user.v1'];
export type MembershipFoundResolution = Extract<
  SignedInUserResolution,
  { kind: 'membership-found' }
>;

const STORAGE_KEY = 'household-account.signed-in-membership.v1';
export const SIGNED_IN_MEMBERSHIP_REVALIDATION_INTERVAL_MS = 30 * 60 * 1_000;

interface StoredMembership {
  version: 1 | 2 | 3 | 4;
  principalUid: string;
  resolution: MembershipFoundResolution;
  verifiedAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decode(value: unknown): StoredMembership | undefined {
  if (
    !isRecord(value)
    || (
      value.version !== 1
      && value.version !== 2
      && value.version !== 3
      && value.version !== 4
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
    ...(typeof value.verifiedAt === 'number'
      && Number.isFinite(value.verifiedAt)
      && value.verifiedAt > 0
      ? { verifiedAt: value.verifiedAt }
      : {}),
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

/**
 * Returns when the cached Membership should converge with the authoritative command again.
 * Legacy cache records have no timestamp and are therefore revalidated after first paint.
 */
export function getSignedInMembershipRevalidationDelay(
  principalUid: string,
  now = Date.now()
): number | undefined {
  if (typeof window === 'undefined' || principalUid.trim() === '') return undefined;
  const stored = readStoredMembership();
  if (stored?.principalUid !== principalUid) return undefined;
  if (stored.verifiedAt === undefined) return 0;
  return Math.min(
    SIGNED_IN_MEMBERSHIP_REVALIDATION_INTERVAL_MS,
    Math.max(
      0,
      stored.verifiedAt + SIGNED_IN_MEMBERSHIP_REVALIDATION_INTERVAL_MS - now
    )
  );
}

export function invalidateSignedInMembershipVerification(
  principalUid: string
): void {
  if (typeof window === 'undefined' || principalUid.trim() === '') return;
  const stored = readStoredMembership();
  if (stored?.principalUid !== principalUid) return;
  const { verifiedAt: _verifiedAt, ...retained } = stored;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...retained, version: 4 })
  );
}

/** 화면 데이터 없이 인증된 Membership 연결 정보만 보존합니다. */
export function writeSignedInMembershipCache(
  principalUid: string,
  resolution: MembershipFoundResolution,
  options: { preserveVerificationTime?: boolean } = {}
): void {
  if (typeof window === 'undefined' || principalUid.trim() === '') return;
  const current = readStoredMembership();
  const retainedVerifiedAt =
    current?.principalUid === principalUid
    && current.resolution.membership.householdId === resolution.membership.householdId
      ? current.verifiedAt
      : undefined;
  const stored: StoredMembership = {
    version: 4,
    principalUid,
    resolution,
    ...(options.preserveVerificationTime
      ? (retainedVerifiedAt !== undefined ? { verifiedAt: retainedVerifiedAt } : {})
      : { verifiedAt: Date.now() }),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearSignedInMembershipCache(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
