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
import { usePathname } from 'next/navigation';
import { useHousehold } from '@/contexts/HouseholdContext';
import { ANDROID_NATIVE_RESUME_EVENT } from '@/platform/android-host/androidLifecycleEvents';
import type { LocalCurrencyBalance } from '@/lib/balanceService';
import type { Expense, TransactionType } from '@/types/expense';

interface LedgerQuery {
  readonly year: number;
  readonly month: number;
  readonly transactionType: TransactionType;
}

type LedgerReadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface LedgerReadModelContextValue {
  readonly activeQuery: LedgerQuery;
  readonly sourceHouseholdId: string | null;
  readonly expenses: Expense[];
  readonly status: LedgerReadStatus;
  readonly error: unknown;
  readonly localCurrencyBalance: LocalCurrencyBalance | null;
  readonly localCurrencyStatus: LedgerReadStatus;
  readonly readRefreshKey: string;
  selectQuery(query: LedgerQuery): void;
}

interface LedgerReadModelView {
  readonly expenses: Expense[];
  readonly isLoading: boolean;
  readonly serverSnapshotReady: boolean;
  readonly readError: unknown;
  readonly localCurrencyBalance: LocalCurrencyBalance | null;
  readonly localCurrencySettled: boolean;
  readonly readRefreshKey: string;
}

const LedgerReadModelContext = createContext<LedgerReadModelContextValue | undefined>(
  undefined
);

function currentQuery(pathname: string): LedgerQuery {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    transactionType: pathname === '/income' ? 'income' : 'expense',
  };
}

function sameQuery(left: LedgerQuery, right: LedgerQuery): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.transactionType === right.transactionType;
}

function isLedgerRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/income';
}

/**
 * 현재 월 원장과 지역화폐 read model을 Household 화면보다 먼저 구독합니다.
 *
 * Membership이 확정되면 Household 문서와 독립적으로 서버 구독을 시작하므로, 과거 화면
 * snapshot을 표시하지 않으면서도 두 원격 왕복이 직렬화되지 않습니다.
 */
export function LedgerReadModelProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    householdKey,
    isSessionVerified,
    remoteReadEpoch = 0,
  } = useHousehold();
  const [activeQuery, setActiveQuery] = useState<LedgerQuery>(() =>
    currentQuery(pathname)
  );
  const [sourceHouseholdId, setSourceHouseholdId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
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

  const selectQuery = useCallback((nextQuery: LedgerQuery) => {
    if (sameQuery(activeQuery, nextQuery)) return;
    readyQueryRef.current = null;
    setExpenses([]);
    setStatus('loading');
    setError(null);
    setActiveQuery(nextQuery);
  }, [activeQuery]);

  useLayoutEffect(() => {
    if (!isLedgerRoute(pathname)) return;
    const expectedType: TransactionType = pathname === '/income' ? 'income' : 'expense';
    if (activeQuery.transactionType === expectedType) return;
    selectQuery({ ...activeQuery, transactionType: expectedType });
  }, [activeQuery, pathname, selectQuery]);

  useEffect(() => {
    if (
      !isLedgerRoute(pathname)
      || !isSessionVerified
      || !householdKey
    ) return undefined;

    const handleNativeResume = () => {
      setNativeResumeEpoch((current) => current + 1);
    };
    window.addEventListener(ANDROID_NATIVE_RESUME_EVENT, handleNativeResume);
    return () => {
      window.removeEventListener(ANDROID_NATIVE_RESUME_EVENT, handleNativeResume);
    };
  }, [householdKey, isSessionVerified, pathname]);

  const readRefreshKey = `${remoteReadEpoch}:${nativeResumeEpoch}`;

  useEffect(() => {
    if (
      !isLedgerRoute(pathname)
      || !isSessionVerified
      || !householdKey
    ) {
      sourceHouseholdRef.current = null;
      readyQueryRef.current = null;
      setSourceHouseholdId(null);
      setExpenses([]);
      setStatus('idle');
      setError(null);
      return undefined;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const householdChanged = sourceHouseholdRef.current !== householdKey;
    const readQueryKey = [
      householdKey,
      activeQuery.year,
      activeQuery.month,
      activeQuery.transactionType,
    ].join('\u0000');
    const preserveCurrentRead = readyQueryRef.current === readQueryKey;
    sourceHouseholdRef.current = householdKey;
    setSourceHouseholdId(householdKey);
    if (householdChanged) setExpenses([]);
    if (!preserveCurrentRead) setStatus('loading');
    setError(null);

    void import('@/lib/expenseService')
      .then(({ subscribeToMonthlyExpenses }) => {
        if (cancelled) return;
        unsubscribe = subscribeToMonthlyExpenses(
          activeQuery.year,
          activeQuery.month,
          (nextExpenses) => {
            if (cancelled) return;
            readyQueryRef.current = readQueryKey;
            setExpenses(nextExpenses);
            setStatus('ready');
            setError(null);
          },
          {
            transactionType: activeQuery.transactionType,
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
    activeQuery.month,
    activeQuery.transactionType,
    activeQuery.year,
    householdKey,
    isSessionVerified,
    pathname,
    readRefreshKey,
  ]);

  useEffect(() => {
    if (
      pathname !== '/'
      || !isSessionVerified
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
  }, [householdKey, isSessionVerified, pathname, readRefreshKey]);

  const value = useMemo<LedgerReadModelContextValue>(() => ({
    activeQuery,
    sourceHouseholdId,
    expenses,
    status,
    error,
    localCurrencyBalance,
    localCurrencyStatus,
    readRefreshKey,
    selectQuery,
  }), [
    activeQuery,
    error,
    expenses,
    localCurrencyBalance,
    localCurrencyStatus,
    readRefreshKey,
    selectQuery,
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

  const { selectQuery } = context;
  useLayoutEffect(() => {
    selectQuery(query);
  }, [query.month, query.transactionType, query.year, selectQuery]);

  const matches =
    context.sourceHouseholdId === householdKey
    && sameQuery(context.activeQuery, query);

  return {
    expenses: matches ? context.expenses : [],
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
  };
}
