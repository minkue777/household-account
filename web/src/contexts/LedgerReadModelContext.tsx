'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { ANDROID_NATIVE_RESUME_EVENT } from '@/platform/android-host/androidLifecycleEvents';
import type { LocalCurrencyBalance } from '@/lib/balanceService';
import type { Expense, TransactionType } from '@/types/expense';

interface LedgerPeriod {
  readonly year: number;
  readonly month: number;
}

interface LedgerQuery extends LedgerPeriod {
  readonly transactionType: TransactionType;
}

type LedgerReadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface LedgerReadModelContextValue {
  readonly activePeriod: LedgerPeriod;
  readonly sourceHouseholdId: string | null;
  readonly transactions: Expense[];
  readonly status: LedgerReadStatus;
  readonly error: unknown;
  readonly localCurrencyBalance: LocalCurrencyBalance | null;
  readonly localCurrencyStatus: LedgerReadStatus;
  readonly readRefreshKey: string;
  selectPeriod(period: LedgerPeriod): void;
  prefetchAdjacentPeriods(): () => void;
}

interface LedgerReadModelView {
  readonly expenses: Expense[];
  readonly isLoading: boolean;
  readonly serverSnapshotReady: boolean;
  readonly readError: unknown;
  readonly localCurrencyBalance: LocalCurrencyBalance | null;
  readonly localCurrencySettled: boolean;
  readonly readRefreshKey: string;
  prefetchAdjacentPeriods(): () => void;
}

const LedgerReadModelContext = createContext<LedgerReadModelContextValue | undefined>(
  undefined
);

function currentPeriod(): LedgerPeriod {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

function samePeriod(left: LedgerPeriod, right: LedgerPeriod): boolean {
  return left.year === right.year
    && left.month === right.month;
}

function shiftPeriod(period: LedgerPeriod, offset: number): LedgerPeriod {
  const date = new Date(period.year, period.month - 1 + offset, 1);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
  };
}

function periodCacheKey(
  householdId: string,
  period: LedgerPeriod
): string {
  return [
    householdId,
    period.year,
    period.month,
  ].join('\u0000');
}

/**
 * 현재 월 원장과 지역화폐 read model을 Household 화면보다 먼저 구독합니다.
 *
 * Membership이 확정되면 Household 문서와 독립적으로 서버 구독을 시작하므로, 과거 화면
 * snapshot을 표시하지 않으면서도 두 원격 왕복이 직렬화되지 않습니다.
 */
export function LedgerReadModelProvider({ children }: { children: ReactNode }) {
  const {
    householdKey,
    isSessionVerified,
    remoteReadEpoch = 0,
  } = useHousehold();
  const [activePeriod, setActivePeriod] = useState<LedgerPeriod>(currentPeriod);
  const [sourceHouseholdId, setSourceHouseholdId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Expense[]>([]);
  const [status, setStatus] = useState<LedgerReadStatus>('idle');
  const [error, setError] = useState<unknown>(null);
  const [localCurrencyBalance, setLocalCurrencyBalance] =
    useState<LocalCurrencyBalance | null>(null);
  const [localCurrencyStatus, setLocalCurrencyStatus] =
    useState<LedgerReadStatus>('idle');
  const [nativeResumeEpoch, setNativeResumeEpoch] = useState(0);
  const sourceHouseholdRef = useRef<string | null>(null);
  const readyQueryRef = useRef<string | null>(null);
  const balanceHouseholdRef = useRef<string | null>(null);
  const activePeriodRef = useRef(activePeriod);
  const periodCacheRef = useRef(new Map<string, Expense[]>());
  const prefetchingPeriodKeysRef = useRef(new Set<string>());
  activePeriodRef.current = activePeriod;

  const selectPeriod = useCallback((nextPeriod: LedgerPeriod) => {
    if (samePeriod(activePeriod, nextPeriod)) return;
    const nextQueryKey = householdKey
      ? periodCacheKey(householdKey, nextPeriod)
      : null;
    const prefetchedTransactions = nextQueryKey
      ? periodCacheRef.current.get(nextQueryKey)
      : undefined;
    if (prefetchedTransactions !== undefined) {
      readyQueryRef.current = nextQueryKey;
      setTransactions(prefetchedTransactions);
      setStatus('ready');
    } else {
      readyQueryRef.current = null;
      setTransactions([]);
      setStatus('loading');
    }
    setError(null);
    setActivePeriod(nextPeriod);
  }, [activePeriod, householdKey]);

  const prefetchAdjacentPeriods = useCallback(() => {
    if (
      !isSessionVerified
      || !householdKey
      || status !== 'ready'
    ) return () => {};

    const targetHouseholdId = householdKey;
    const candidates = [
      shiftPeriod(activePeriod, -1),
      shiftPeriod(activePeriod, 1),
    ].filter((period) => {
      const key = periodCacheKey(targetHouseholdId, period);
      return !periodCacheRef.current.has(key)
        && !prefetchingPeriodKeysRef.current.has(key);
    });
    if (candidates.length === 0) return () => {};

    const candidateKeys = candidates.map((period) =>
      periodCacheKey(targetHouseholdId, period)
    );
    candidateKeys.forEach((key) => prefetchingPeriodKeysRef.current.add(key));

    let cancelled = false;
    let idleCallbackId: number | undefined;
    let fallbackId: number | undefined;

    const run = () => {
      void import('@/lib/expenseService')
        .then(async ({ readMonthlyTransactionsForPrefetch }) => {
          await Promise.all(candidates.map(async (period, index) => {
            const key = candidateKeys[index];
            if (
              cancelled
              || sourceHouseholdRef.current !== targetHouseholdId
              || samePeriod(activePeriodRef.current, period)
            ) {
              prefetchingPeriodKeysRef.current.delete(key);
              return;
            }
            try {
              const prefetchedTransactions =
                await readMonthlyTransactionsForPrefetch(period.year, period.month);
              if (
                !cancelled
                && sourceHouseholdRef.current === targetHouseholdId
                && !samePeriod(activePeriodRef.current, period)
              ) {
                periodCacheRef.current.set(key, prefetchedTransactions);
              }
            } catch {
              // 선택 월의 권위 read와 무관한 선택적 최적화이므로 조용히 건너뜁니다.
            } finally {
              prefetchingPeriodKeysRef.current.delete(key);
            }
          }));
        })
        .catch(() => {
          candidateKeys.forEach((key) =>
            prefetchingPeriodKeysRef.current.delete(key)
          );
        });
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleCallbackId = window.requestIdleCallback(run, { timeout: 5_000 });
    } else {
      fallbackId = window.setTimeout(run, 0);
    }

    return () => {
      cancelled = true;
      candidateKeys.forEach((key) =>
        prefetchingPeriodKeysRef.current.delete(key)
      );
      if (
        idleCallbackId !== undefined
        && typeof window.cancelIdleCallback === 'function'
      ) {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (fallbackId !== undefined) {
        window.clearTimeout(fallbackId);
      }
    };
  }, [
    activePeriod,
    householdKey,
    isSessionVerified,
    status,
  ]);

  useEffect(() => {
    if (
      !isSessionVerified
      || !householdKey
    ) return undefined;

    const handleNativeResume = () => {
      setNativeResumeEpoch((current) => current + 1);
    };
    window.addEventListener(ANDROID_NATIVE_RESUME_EVENT, handleNativeResume);
    return () => {
      window.removeEventListener(ANDROID_NATIVE_RESUME_EVENT, handleNativeResume);
    };
  }, [householdKey, isSessionVerified]);

  const readRefreshKey = `${remoteReadEpoch}:${nativeResumeEpoch}`;

  useEffect(() => {
    if (
      !isSessionVerified
      || !householdKey
    ) {
      sourceHouseholdRef.current = null;
      readyQueryRef.current = null;
      periodCacheRef.current.clear();
      prefetchingPeriodKeysRef.current.clear();
      setSourceHouseholdId(null);
      setTransactions([]);
      setStatus('idle');
      setError(null);
      return undefined;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const householdChanged = sourceHouseholdRef.current !== householdKey;
    const readQueryKey = periodCacheKey(householdKey, activePeriod);
    const preserveCurrentRead = readyQueryRef.current === readQueryKey;
    if (householdChanged) {
      periodCacheRef.current.clear();
      prefetchingPeriodKeysRef.current.clear();
    }
    sourceHouseholdRef.current = householdKey;
    setSourceHouseholdId(householdKey);
    if (householdChanged) setTransactions([]);
    if (!preserveCurrentRead) setStatus('loading');
    setError(null);

    void import('@/lib/expenseService')
      .then(({ subscribeToMonthlyTransactions }) => {
        if (cancelled) return;
        unsubscribe = subscribeToMonthlyTransactions(
          activePeriod.year,
          activePeriod.month,
          (nextTransactions) => {
            if (cancelled) return;
            readyQueryRef.current = readQueryKey;
            periodCacheRef.current.set(readQueryKey, nextTransactions);
            setTransactions(nextTransactions);
            setStatus('ready');
            setError(null);
          },
          {
            onError: (readError) => {
              if (cancelled) return;
              if (!preserveCurrentRead) setStatus('error');
              setError(readError);
            },
          }
        );
      })
      .catch((readError) => {
        if (cancelled) return;
        if (!preserveCurrentRead) setStatus('error');
        setError(readError);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    activePeriod.month,
    activePeriod.year,
    householdKey,
    isSessionVerified,
    readRefreshKey,
  ]);

  useEffect(() => {
    if (
      !isSessionVerified
      || !householdKey
    ) {
      balanceHouseholdRef.current = null;
      setLocalCurrencyBalance(null);
      setLocalCurrencyStatus('idle');
      return undefined;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const householdChanged = balanceHouseholdRef.current !== householdKey;
    balanceHouseholdRef.current = householdKey;
    if (householdChanged) {
      setLocalCurrencyBalance(null);
      setLocalCurrencyStatus('loading');
    } else {
      setLocalCurrencyStatus((current) =>
        current === 'idle' || current === 'error' ? 'loading' : current
      );
    }
    void import('@/lib/balanceService')
      .then(({ subscribeToLocalCurrencyBalance }) => {
        if (cancelled) return;
        unsubscribe = subscribeToLocalCurrencyBalance((balance) => {
          if (cancelled) return;
          setLocalCurrencyBalance(balance);
          setLocalCurrencyStatus('ready');
        }, {
          onError: () => {
            if (!cancelled) setLocalCurrencyStatus('error');
          },
        });
      })
      .catch(() => {
        if (!cancelled) setLocalCurrencyStatus('error');
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [householdKey, isSessionVerified, readRefreshKey]);

  const value = useMemo<LedgerReadModelContextValue>(() => ({
    activePeriod,
    sourceHouseholdId,
    transactions,
    status,
    error,
    localCurrencyBalance,
    localCurrencyStatus,
    readRefreshKey,
    selectPeriod,
    prefetchAdjacentPeriods,
  }), [
    activePeriod,
    error,
    transactions,
    localCurrencyBalance,
    localCurrencyStatus,
    readRefreshKey,
    selectPeriod,
    prefetchAdjacentPeriods,
    sourceHouseholdId,
    status,
  ]);

  return (
    <LedgerReadModelContext.Provider value={value}>
      {children}
    </LedgerReadModelContext.Provider>
  );
}

export function useLedgerReadModel(query: LedgerQuery): LedgerReadModelView {
  const context = useContext(LedgerReadModelContext);
  const { householdKey } = useHousehold();
  if (!context) {
    throw new Error(
      'useLedgerReadModel must be used within a LedgerReadModelProvider'
    );
  }

  const { selectPeriod } = context;
  useLayoutEffect(() => {
    selectPeriod(query);
  }, [query.month, query.year, selectPeriod]);

  const matches =
    context.sourceHouseholdId === householdKey
    && samePeriod(context.activePeriod, query);
  const expenses = useMemo(
    () => matches
      ? context.transactions.filter(
          (transaction) =>
            (transaction.transactionType ?? 'expense') === query.transactionType
        )
      : [],
    [context.transactions, matches, query.transactionType]
  );

  return {
    expenses,
    isLoading: !matches || context.status === 'idle' || context.status === 'loading',
    serverSnapshotReady: matches && context.status === 'ready',
    readError: matches ? context.error : null,
    localCurrencyBalance:
      query.transactionType === 'expense' ? context.localCurrencyBalance : null,
    localCurrencySettled:
      query.transactionType !== 'expense'
      || context.localCurrencyStatus === 'ready'
      || context.localCurrencyStatus === 'error',
    readRefreshKey: context.readRefreshKey,
    prefetchAdjacentPeriods: context.prefetchAdjacentPeriods,
  };
}
