import { act, render } from '@testing-library/react';

const markWebFirstLedgerPaint = jest.fn();
const markWebFirstHomeCompletePaint = jest.fn();
const prefetchAdjacentPeriods = jest.fn(() => jest.fn());
const scheduleHomePrefetch = jest.fn((_task: () => void, _options?: { fallbackMs?: number }) => jest.fn());

let categoryRead = {
  isLoading: true,
  serverSnapshotReady: false,
};
let ledgerRead = {
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
    householdKey: 'household-1',
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
  markWebFirstLedgerPaint: () => markWebFirstLedgerPaint(),
  markWebFirstHomeCompletePaint: () => markWebFirstHomeCompletePaint(),
  scheduleAfterWebFirstHomeCompletePaint: (task: () => void, options?: { fallbackMs?: number }) => scheduleHomePrefetch(task, options),
}));

jest.mock('@/components/Calendar', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/CategorySummary', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/BalanceCards', () => ({
  __esModule: true,
  default: () => null,
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
    categoryRead = { isLoading: false, serverSnapshotReady: true };
    const view = render(<LedgerPage transactionType="expense" />);
    flushFrame();
    flushFrame();
    expect(markWebFirstLedgerPaint).toHaveBeenCalled();
    expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();
    expect(prefetchAdjacentPeriods).not.toHaveBeenCalled();
    expect(scheduleHomePrefetch).toHaveBeenCalledWith(expect.any(Function), { fallbackMs: 15_000 });
    act(() => scheduleHomePrefetch.mock.calls[0][0]());
    expect(prefetchAdjacentPeriods).toHaveBeenCalledTimes(1);
    const cancelPrefetch = prefetchAdjacentPeriods.mock.results[0].value;
    view.unmount();
    expect(cancelPrefetch).toHaveBeenCalledTimes(1);
    expect(scheduleHomePrefetch.mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  it('읽기 세대가 바뀌거나 화면을 떠나면 아직 시작하지 않은 사전 조회 예약을 취소한다', () => {
    ledgerRead = { ...ledgerRead, isLoading: false, serverSnapshotReady: true, localCurrencySettled: true };
    categoryRead = { isLoading: false, serverSnapshotReady: true };
    const view = render(<LedgerPage transactionType="expense" />);
    const cancelFirst = scheduleHomePrefetch.mock.results[0].value;
    ledgerRead = { ...ledgerRead, readRefreshKey: 'read-2' };
    view.rerender(<LedgerPage transactionType="expense" />);
    expect(cancelFirst).toHaveBeenCalledTimes(1);
    expect(scheduleHomePrefetch).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(scheduleHomePrefetch.mock.results[1].value).toHaveBeenCalledTimes(1);
    expect(prefetchAdjacentPeriods).not.toHaveBeenCalled();
  });
});
