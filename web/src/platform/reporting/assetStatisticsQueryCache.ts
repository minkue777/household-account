import { getClientSessionScope, requireClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { registerClientSessionReset } from '@/composition/clientSessionResetRegistry';
import type { AssetHistoryEntry } from '@/types/asset';

export interface AssetStatisticsReadOptions {
  cacheEpoch?: number;
}

type Entry = {
  key: string;
  completed?: AssetHistoryEntry[];
  pending?: Promise<AssetHistoryEntry[]>;
};
let cached: Entry | undefined;
const invalidationListeners = new Set<() => void>();

export function assetStatisticsSessionKey(scope: ClientSessionScope): string {
  return JSON.stringify([scope.principalUid, scope.householdId, scope.memberId,
    scope.sessionGeneration, scope.accessMode ?? 'member']);
}

function historyKey(scope: ClientSessionScope, endDate: string, options: AssetStatisticsReadOptions): string {
  return JSON.stringify([assetStatisticsSessionKey(scope), endDate, options.cacheEpoch ?? 0]);
}

function clearCache(): void {
  cached = undefined;
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

/** Display the last complete history while the caller verifies it again. */
export function peekCachedAssetStatistics(endDate: string, options: AssetStatisticsReadOptions = {}): AssetHistoryEntry[] | undefined {
  const scope = getClientSessionScope();
  return scope && cached?.key === historyKey(scope, endDate, options) ? cached.completed : undefined;
}

/** Each completed read is revalidated; concurrent callers share one request. */
export async function readCachedAssetStatistics(
  endDate: string,
  load: (assertCurrent: () => void) => Promise<AssetHistoryEntry[]>,
  options: AssetStatisticsReadOptions = {},
): Promise<AssetHistoryEntry[]> {
  const scope = requireClientSessionScope();
  const key = historyKey(scope, endDate, options);
  if (cached?.key !== key) cached = { key };
  const entry = cached;
  const assertCurrent = () => {
    const current = getClientSessionScope();
    // Entry identity also rejects an old read after resetting to the same actor.
    if (cached !== entry || !current || historyKey(current, endDate, options) !== key) {
      throw new Error('STATISTICS_SESSION_CHANGED');
    }
  };
  if (!entry.pending) {
    entry.pending = Promise.resolve().then(() => {
      assertCurrent();
      return load(assertCurrent);
    }).then(value => {
      assertCurrent();
      entry.completed = value;
      return value;
    }).finally(() => { entry.pending = undefined; });
  }
  const result = await entry.pending;
  assertCurrent();
  return result;
}
