import { act, render, screen } from '@testing-library/react';
import type { HomeSummaryConfig } from '@/types/household';

const markWebFirstLedgerPaint = jest.fn();
const markWebFirstHomeCompletePaint = jest.fn();
const prefetchAdjacentPeriods = jest.fn(() => jest.fn());
type PrefetchOptions = { fallbackMs?: number; idleTimeoutMs?: number };
const scheduleHomePrefetch = jest.fn((_task: () => void, _options?: PrefetchOptions) => jest.fn());

let categoryRead = {
  isLoading: true,
  serverSnapshotReady: false,
  readError: null as unknown,
};
let ledgerRead = {
  expenses: [],
  isLoading: true,
  serverSnapshotReady: false,
  readError: null as unknown,
  localCurrencyBalance: null,
  localCurrencySettled: false,
  localCurrencyReady: false,
  readRefreshKey: 'read-1',
  prefetchAdjacentPeriods,
};
let householdKey = 'household-1';
let preferencesRead = {
  configuration: { leftCard: 'monthlySpent', rightCard: 'monthlyRemainingBudget' } as HomeSummaryConfig,
  ready: true, error: false,
};
let yearRead = { expenses: [], total: null as number | null, error: false };
jest.mock('@/features/home-preferences/homePreferences', () => ({ useHomePreferences: () => preferencesRead }));
jest.mock('@/features/ledger/useLedgerYearSummary', () => ({ useLedgerYearSummary: () => yearRead }));

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: () => ({
    household: {
      id: 'household-1',
      name: '테스트네',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      members: [],
      homeSummaryConfig: {
        leftCard: 'monthlySpent',
        rightCard: 'monthlyRemainingBudget',
      },
    },
    householdKey,
    isSessionVerified: true,
  }),
}));

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => categoryRead,
}));

jest.mock('@/contexts/LedgerReadModelContext', () => ({
  useLedgerReadModel: () => ledgerRead,
}));

jest.mock('@/platform/performance/webStartupPerformance', () => ({
  markWebLedgerCacheResult: jest.fn(),
  markWebHomeReadiness: jest.fn(),
  markWebFirstLedgerPaint: () => markWebFirstLedgerPaint(),
  markWebFirstHomeCompletePaint: () => markWebFirstHomeCompletePaint(),
  scheduleAfterWebFirstHomeCompletePaint: (task: () => void, options?: PrefetchOptions) => scheduleHomePrefetch(task, options),
}));

jest.mock('@/components/Calendar', () => ({
  __esModule: true,
  default: () => <div data-testid="home-calendar" />,
}));
jest.mock('@/components/CategorySummary', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/BalanceCards', () => ({
  __esModule: true,
  default: () => <div data-testid="home-cards" />,
}));
jest.mock('@/components/HomeHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/expense/ExpenseDetail', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/CategoryDetailModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/LocalCurrencyModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/expense/AddExpenseModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/expense/IncomeSummaryModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/search/SearchModal', () => ({
  __esModule: true,
  default: () => null,
}));

import LedgerPage from '@/components/home/LedgerPage';

describe('first home complete paint contract', () => {
  let frameCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    jest.clearAllMocks();
    categoryRead = {
      isLoading: true,
      serverSnapshotReady: false,
      readError: null,
    };
    ledgerRead = {
      expenses: [],
      isLoading: true,
      serverSnapshotReady: false,
      readError: null,
      localCurrencyBalance: null,
      localCurrencySettled: false,
      localCurrencyReady: false,
      readRefreshKey: 'read-1',
      prefetchAdjacentPeriods,
    };
    householdKey = 'household-1';
    preferencesRead = { configuration: { leftCard: 'monthlySpent', rightCard: 'monthlyRemainingBudget' }, ready: true, error: false };
    yearRead = { expenses: [], total: null, error: false };
    frameCallbacks = [];
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function flushFrame() {
    const callbacks = frameCallbacks;
    frameCallbacks = [];
    act(() => callbacks.forEach((callback) => callback(0)));
  }

  function schedulesFor(option: keyof PrefetchOptions, value: number) {
    return scheduleHomePrefetch.mock.calls.flatMap(([task, options], index) => (
      options?.[option] === value
        ? [{ task, options, cancel: scheduleHomePrefetch.mock.results[index].value }]
        : []
    ));
  }

  it('[T-ANDROID-STARTUP-001][AND-014/ADM-005] 월 원장·카테고리·지역화폐가 모두 성공하고 실제 두 frame이 지난 뒤 한 번 완료한다', () => {
    const view = render(<LedgerPage transactionType="expense" />);
    expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();

    ledgerRead = {
      ...ledgerRead,
      isLoading: false,
      serverSnapshotReady: true,
      localCurrencySettled: true,
    };
    view.rerender(<LedgerPage transactionType="expense" />);
    flushFrame();
    flushFrame();
    expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();

    categoryRead = {
      isLoading: false,
      serverSnapshotReady: true,
      readError: null,
    };
    ledgerRead = {
      ...ledgerRead,
      localCurrencyReady: true,
    };
    view.rerender(<LedgerPage transactionType="expense" />);

    flushFrame();
    expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();
    flushFrame();
    expect(markWebFirstHomeCompletePaint).toHaveBeenCalledTimes(1);
  });

  it('먼저 도착한 월 원장만으로 인접 월을 조회하지 않고 전체 paint 예약을 기다린다', () => {
    ledgerRead = { ...ledgerRead, isLoading: false, serverSnapshotReady: true, localCurrencySettled: true };
    categoryRead = { isLoading: false, serverSnapshotReady: true, readError: null };
    const view = render(<LedgerPage transactionType="expense" />);
    flushFrame();
    flushFrame();
    expect(markWebFirstLedgerPaint).not.toHaveBeenCalled();
    expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();
    expect(prefetchAdjacentPeriods).not.toHaveBeenCalled();
    expect(scheduleHomePrefetch).toHaveBeenCalledWith(expect.any(Function), { fallbackMs: 15_000 });
    const adjacentSchedules = schedulesFor('fallbackMs', 15_000);
    expect(adjacentSchedules).toHaveLength(1);
    act(() => adjacentSchedules[0].task());
    expect(prefetchAdjacentPeriods).toHaveBeenCalledTimes(1);
    const cancelPrefetch = prefetchAdjacentPeriods.mock.results[0].value;
    view.unmount();
    expect(cancelPrefetch).toHaveBeenCalledTimes(1);
    expect(adjacentSchedules[0].cancel).toHaveBeenCalledTimes(1);
  });

  it('읽기 세대가 바뀌거나 화면을 떠나면 아직 시작하지 않은 사전 조회 예약을 취소한다', () => {
    ledgerRead = { ...ledgerRead, isLoading: false, serverSnapshotReady: true, localCurrencySettled: true };
    categoryRead = { isLoading: false, serverSnapshotReady: true, readError: null };
    const view = render(<LedgerPage transactionType="expense" />);
    const firstAdjacentSchedules = schedulesFor('fallbackMs', 15_000);
    const detailSchedules = schedulesFor('idleTimeoutMs', 1_000);
    expect(firstAdjacentSchedules).toHaveLength(1);
    expect(detailSchedules).toHaveLength(1);
    expect(detailSchedules[0].options).toEqual({ idleTimeoutMs: 1_000 });
    expect(scheduleHomePrefetch).toHaveBeenCalledTimes(2);
    const cancelFirst = firstAdjacentSchedules[0].cancel;
    ledgerRead = { ...ledgerRead, readRefreshKey: 'read-2' };
    view.rerender(<LedgerPage transactionType="expense" />);
    expect(cancelFirst).toHaveBeenCalledTimes(1);
    expect(detailSchedules[0].cancel).not.toHaveBeenCalled();
    expect(schedulesFor('idleTimeoutMs', 1_000)).toHaveLength(1);
    const adjacentSchedules = schedulesFor('fallbackMs', 15_000);
    expect(adjacentSchedules).toHaveLength(2);
    expect(scheduleHomePrefetch).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(adjacentSchedules[1].cancel).toHaveBeenCalledTimes(1);
    expect(detailSchedules[0].cancel).toHaveBeenCalledTimes(1);
    expect(prefetchAdjacentPeriods).not.toHaveBeenCalled();
  });

  function prepareHome() {
    ledgerRead = { ...ledgerRead, isLoading: false, serverSnapshotReady: true, localCurrencySettled: true, localCurrencyReady: true };
    categoryRead = { isLoading: false, serverSnapshotReady: true, readError: null };
    preferencesRead.ready = true;
    yearRead.total = 0;
  }

  it.each(['ledger', 'categories', 'currency', 'preferences', 'year'])(
    '[LED-001][HOME-003] %s가 마지막으로 도착할 때까지 첫 카드와 달력을 함께 숨긴다', source => {
      prepareHome();
      if (source === 'ledger') ledgerRead = { ...ledgerRead, serverSnapshotReady: false, isLoading: true };
      if (source === 'categories') categoryRead = { ...categoryRead, serverSnapshotReady: false, isLoading: true };
      if (source === 'currency') ledgerRead = { ...ledgerRead, localCurrencySettled: false, localCurrencyReady: false };
      if (source === 'preferences') preferencesRead.ready = false;
      if (source === 'year') {
        preferencesRead.configuration.leftCard = 'yearlySpent';
        yearRead.total = null;
      }
      const view = render(<LedgerPage transactionType="expense" />);
      flushFrame(); flushFrame();
      expect(screen.queryByTestId('home-cards')).not.toBeInTheDocument();
      expect(screen.queryByTestId('home-calendar')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('가계부를 불러오는 중');
      expect(markWebFirstLedgerPaint).not.toHaveBeenCalled();
      expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();
      prepareHome();
      view.rerender(<LedgerPage transactionType="expense" />);
      expect(screen.getByTestId('home-cards')).toBeVisible();
      expect(screen.getByTestId('home-calendar')).toBeVisible();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      flushFrame(); flushFrame();
      expect(markWebFirstLedgerPaint).toHaveBeenCalledTimes(1);
      expect(markWebFirstHomeCompletePaint).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['ledger', 'categories', 'currency', 'preferences', 'year'])(
    '[LED-001] 첫 %s 조회 실패는 로딩을 끝내고 재시도를 제공한다', source => {
      prepareHome();
      if (source === 'ledger') ledgerRead = { ...ledgerRead, serverSnapshotReady: false, readError: new Error('offline') };
      if (source === 'categories') categoryRead = { ...categoryRead, serverSnapshotReady: false, readError: new Error('offline') };
      if (source === 'currency') ledgerRead = { ...ledgerRead, localCurrencyReady: false };
      if (source === 'preferences') preferencesRead = { ...preferencesRead, ready: false, error: true };
      if (source === 'year') {
        preferencesRead.configuration.leftCard = 'yearlySpent';
        yearRead = { expenses: [], total: null, error: true };
      }
      render(<LedgerPage transactionType="expense" />);
      expect(screen.getByRole('alert')).toHaveTextContent('가계부를 불러오지 못했습니다.');
      expect(screen.getByRole('button', { name: '다시 시도' })).toBeVisible();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByTestId('home-calendar')).not.toBeInTheDocument();
      flushFrame(); flushFrame();
      expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();
    },
  );

  it('[LED-001] 표시한 가구의 재조회·실패에는 화면을 유지하고 가구 전환에는 다시 기다린다', () => {
    prepareHome();
    const view = render(<LedgerPage transactionType="expense" />);
    const cards = screen.getByTestId('home-cards');
    categoryRead = { ...categoryRead, serverSnapshotReady: false };
    ledgerRead = { ...ledgerRead, localCurrencyReady: false, localCurrencySettled: false };
    view.rerender(<LedgerPage transactionType="expense" />);
    expect(screen.getByTestId('home-cards')).toBe(cards);
    ledgerRead = { ...ledgerRead, localCurrencySettled: true };
    view.rerender(<LedgerPage transactionType="expense" />);
    expect(screen.getByTestId('home-cards')).toBe(cards);
    householdKey = 'household-2';
    view.rerender(<LedgerPage transactionType="expense" />);
    expect(screen.queryByTestId('home-cards')).not.toBeInTheDocument();
    householdKey = 'household-1';
    view.rerender(<LedgerPage transactionType="expense" />);
    expect(screen.queryByTestId('home-cards')).not.toBeInTheDocument();
  });
});
