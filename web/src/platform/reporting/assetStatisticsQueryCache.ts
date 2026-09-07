import { getClientSessionScope, requireClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { registerClientSessionReset } from '@/composition/clientSessionResetRegistry';

export interface AssetStatisticsReadOptions {
  cacheEpoch?: number;
  forceRefresh?: boolean;
}

const MAX_AGE_MS = 30_000;
const MAX_ENTRIES = 8;
type Entry = { queryKey: string; task: Promise<unknown>; completedAt?: number };
const entries = new Map<string, Entry>();
const invalidationListeners = new Set<() => void>();
let cachedScope: string | undefined;
let generation = 0;

export function assetStatisticsSessionKey(scope: ClientSessionScope): string {
  return JSON.stringify([scope.principalUid, scope.householdId, scope.memberId,
    scope.sessionGeneration, scope.accessMode ?? 'member']);
}

function clearCache(): void {
  entries.clear();
  cachedScope = undefined;
  generation += 1;
}

export function invalidateAssetStatisticsCache(): void {
  clearCache();
  invalidationListeners.forEach(listener => listener());
}

export function subscribeAssetStatisticsInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => { invalidationListeners.delete(listener); };
}

registerClientSessionReset(clearCache);

/** Only complete server reads are reused, in memory, for this exact actor session. */
export async function readCachedAssetStatistics<T>(
  queryKey: string,
  load: (assertCurrent: () => void) => Promise<T>,
  options: AssetStatisticsReadOptions = {},
): Promise<T> {
  const scopeKey = assetStatisticsSessionKey(requireClientSessionScope());
  if (cachedScope !== scopeKey) {
    clearCache();
    cachedScope = scopeKey;
  }
  const startedGeneration = generation;
  const key = JSON.stringify([queryKey, options.cacheEpoch ?? 0]);
  let expectedEntry: Entry | undefined;
  const assertCurrent = () => {
    const current = getClientSessionScope();
    if (!current || assetStatisticsSessionKey(current) !== scopeKey || generation !== startedGeneration
      || (expectedEntry !== undefined && entries.get(key) !== expectedEntry)) {
      throw new Error('STATISTICS_SESSION_CHANGED');
    }
  };
  // A recovered remote session supersedes earlier reads of the same source.
  entries.forEach((entry, previousKey) => {
    if (entry.queryKey === queryKey && previousKey !== key) entries.delete(previousKey);
  });
  const existing = entries.get(key);
  if (!options.forceRefresh && existing
    && (existing.completedAt === undefined || Date.now() - existing.completedAt < MAX_AGE_MS)) {
    expectedEntry = existing;
    const value = await existing.task;
    assertCurrent();
    return value as T;
  }

  const entry: Entry = { queryKey, task: Promise.resolve().then(() => {
    assertCurrent();
    return load(assertCurrent);
  }) };
  expectedEntry = entry;
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  try {
    const value = await entry.task;
    assertCurrent();
    entry.completedAt = Date.now();
    return value as T;
  } catch (error) {
    if (entries.get(key) === entry) entries.delete(key);
    throw error;
  }
}
