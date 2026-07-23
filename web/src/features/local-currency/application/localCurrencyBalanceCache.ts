import { getClientSessionScope } from '@/composition/clientSessionScope';

export interface LocalCurrencyBalance {
  balance: number;
  currencyType: string;
  updatedAt: Date | null;
}

interface CachedLocalCurrencyBalance {
  readonly balance: number;
  readonly currencyType: string;
  readonly updatedAt: string | null;
}

const CACHE_PREFIX = 'household-account.local-currency-balance.v1';

interface BalanceCacheScope {
  readonly principalUid: string;
  readonly householdId: string;
}

function cacheKey(scope: BalanceCacheScope): string {
  return `${CACHE_PREFIX}:${scope.principalUid}:${scope.householdId}`;
}

function parseCachedBalance(value: string | null): LocalCurrencyBalance | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CachedLocalCurrencyBalance>;
    if (
      typeof parsed.balance !== 'number'
      || !Number.isSafeInteger(parsed.balance)
      || typeof parsed.currencyType !== 'string'
      || parsed.currencyType.trim() === ''
      || (parsed.updatedAt !== null && typeof parsed.updatedAt !== 'string')
    ) {
      return null;
    }
    const updatedAt = parsed.updatedAt === null ? null : new Date(parsed.updatedAt);
    if (updatedAt !== null && Number.isNaN(updatedAt.getTime())) return null;
    return {
      balance: parsed.balance,
      currencyType: parsed.currencyType,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function readCachedLocalCurrencyBalance(): LocalCurrencyBalance | null {
  if (typeof window === 'undefined') return null;
  const scope = getClientSessionScope();
  if (!scope) return null;
  return parseCachedBalance(window.localStorage.getItem(cacheKey(scope)));
}

export function writeCachedLocalCurrencyBalance(
  scope: BalanceCacheScope,
  balance: LocalCurrencyBalance | null
): void {
  if (typeof window === 'undefined') return;
  const key = cacheKey(scope);
  if (balance === null) {
    window.localStorage.removeItem(key);
    return;
  }
  const value: CachedLocalCurrencyBalance = {
    balance: balance.balance,
    currencyType: balance.currencyType,
    updatedAt: balance.updatedAt?.toISOString() ?? null,
  };
  window.localStorage.setItem(key, JSON.stringify(value));
}
