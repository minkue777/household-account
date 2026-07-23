import type { AssetOwnerProfileView } from '@/features/access-household/domain/assetOwnerProfile';
import type { Asset } from '@/types/asset';

const SNAPSHOT_VERSION = 1;
const ASSET_STORAGE_PREFIX = 'household-account.assets.v1.';
const OWNER_STORAGE_PREFIX = 'household-account.asset-owner-profiles.v1.';
const ASSET_TYPES = new Set(['savings', 'stock', 'crypto', 'property', 'gold', 'loan']);

interface StoredSnapshot<T> {
  version: number;
  householdId: string;
  values: T[];
}

function key(prefix: string, householdId: string): string {
  return `${prefix}${encodeURIComponent(householdId)}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function storedValues(prefix: string, householdId: string): unknown[] | undefined {
  if (typeof window === 'undefined' || householdId.trim() === '') return undefined;
  try {
    const parsed = record(
      JSON.parse(window.localStorage.getItem(key(prefix, householdId)) ?? 'null')
    );
    if (
      parsed?.version !== SNAPSHOT_VERSION
      || parsed.householdId !== householdId
      || !Array.isArray(parsed.values)
    ) {
      return undefined;
    }
    return parsed.values;
  } catch {
    return undefined;
  }
}

function writeValues<T>(
  prefix: string,
  householdId: string,
  values: readonly T[]
): void {
  if (typeof window === 'undefined' || householdId.trim() === '') return;
  const stored: StoredSnapshot<T> = {
    version: SNAPSHOT_VERSION,
    householdId,
    values: [...values],
  };
  try {
    window.localStorage.setItem(key(prefix, householdId), JSON.stringify(stored));
  } catch {
    // 로컬 저장소가 차단되어도 Firestore 권위 조회는 계속 동작합니다.
  }
}

function decodeDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis) : undefined;
}

function decodeAsset(householdId: string, value: unknown): Asset | undefined {
  const raw = record(value);
  const createdAt = decodeDate(raw?.createdAt);
  const updatedAt = decodeDate(raw?.updatedAt);
  if (
    typeof raw?.id !== 'string'
    || raw.householdId !== householdId
    || typeof raw.name !== 'string'
    || typeof raw.type !== 'string'
    || !ASSET_TYPES.has(raw.type)
    || typeof raw.aggregateVersion !== 'number'
    || !Number.isSafeInteger(raw.aggregateVersion)
    || typeof raw.currentBalance !== 'number'
    || !Number.isFinite(raw.currentBalance)
    || typeof raw.currency !== 'string'
    || typeof raw.isActive !== 'boolean'
    || typeof raw.order !== 'number'
    || !Number.isFinite(raw.order)
    || createdAt === undefined
    || updatedAt === undefined
  ) {
    return undefined;
  }
  const ownerRef = record(raw.ownerRef);
  if (
    raw.ownerRef !== undefined
    && ownerRef?.kind !== 'household'
    && !(ownerRef?.kind === 'profile' && typeof ownerRef.profileId === 'string')
  ) {
    return undefined;
  }
  return {
    ...raw,
    type: raw.type,
    createdAt,
    updatedAt,
  } as Asset;
}

function decodeOwnerProfile(
  householdId: string,
  value: unknown
): AssetOwnerProfileView | undefined {
  const raw = record(value);
  if (
    typeof raw?.profileId !== 'string'
    || raw.householdId !== householdId
    || typeof raw.displayName !== 'string'
    || (raw.profileType !== 'member' && raw.profileType !== 'dependent')
    || (raw.lifecycleState !== 'active' && raw.lifecycleState !== 'archived')
    || typeof raw.aggregateVersion !== 'number'
    || !Number.isSafeInteger(raw.aggregateVersion)
    || (
      raw.linkedMemberId !== undefined
      && typeof raw.linkedMemberId !== 'string'
    )
  ) {
    return undefined;
  }
  return raw as unknown as AssetOwnerProfileView;
}

export function readAssetSnapshot(householdId: string): Asset[] | undefined {
  const values = storedValues(ASSET_STORAGE_PREFIX, householdId);
  if (values === undefined) return undefined;
  const decoded = values.map((value) => decodeAsset(householdId, value));
  return decoded.some((value) => value === undefined)
    ? undefined
    : decoded as Asset[];
}

export function writeAssetSnapshot(
  householdId: string,
  assets: readonly Asset[]
): void {
  writeValues(ASSET_STORAGE_PREFIX, householdId, assets);
}

export function readAssetOwnerProfileSnapshot(
  householdId: string
): AssetOwnerProfileView[] | undefined {
  const values = storedValues(OWNER_STORAGE_PREFIX, householdId);
  if (values === undefined) return undefined;
  const decoded = values.map((value) => decodeOwnerProfile(householdId, value));
  return decoded.some((value) => value === undefined)
    ? undefined
    : decoded as AssetOwnerProfileView[];
}

export function writeAssetOwnerProfileSnapshot(
  householdId: string,
  profiles: readonly AssetOwnerProfileView[]
): void {
  writeValues(OWNER_STORAGE_PREFIX, householdId, profiles);
}
