import type { LocalCurrencyBalance } from '@/lib/balanceService';

const VERSION = 1;
const KEY_PREFIX = 'household-account.local-currency-balance.v1';

interface StoredLocalCurrencyBalance {
  readonly version: typeof VERSION;
  readonly householdId: string;
  readonly balance: number;
  readonly currencyType: string;
  readonly updatedAt: string | null;
}

function key(householdId: string): string {
  return `${KEY_PREFIX}:${householdId}`;
}

export function readLocalCurrencyBalanceSnapshot(
  householdId: string
): LocalCurrencyBalance | null {
  if (typeof window === 'undefined' || householdId === '') return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(key(householdId)) ?? 'null'
    ) as Partial<StoredLocalCurrencyBalance> | null;
    if (
      parsed?.version !== VERSION
      || parsed.householdId !== householdId
      || !Number.isSafeInteger(parsed.balance)
      || typeof parsed.currencyType !== 'string'
      || parsed.currencyType === ''
      || (parsed.updatedAt !== null && typeof parsed.updatedAt !== 'string')
    ) {
      return null;
    }
    const updatedAt = parsed.updatedAt === null ? null : new Date(parsed.updatedAt);
    if (updatedAt !== null && Number.isNaN(updatedAt.getTime())) return null;
    return {
      balance: parsed.balance as number,
      currencyType: parsed.currencyType,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function writeLocalCurrencyBalanceSnapshot(
  householdId: string,
  balance: LocalCurrencyBalance | null
): void {
  if (typeof window === 'undefined' || householdId === '') return;
  try {
    if (balance === null) {
      window.localStorage.removeItem(key(householdId));
      return;
    }
    const stored: StoredLocalCurrencyBalance = {
      version: VERSION,
      householdId,
      balance: balance.balance,
      currencyType: balance.currencyType,
      updatedAt: balance.updatedAt?.toISOString() ?? null,
    };
    window.localStorage.setItem(key(householdId), JSON.stringify(stored));
  } catch {
    // 표시 최적화가 실패해도 Firestore 권위 구독은 계속 동작합니다.
  }
}
