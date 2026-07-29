import { act, render } from '@testing-library/react';

const markWebFirstLedgerPaint = jest.fn();
const markWebFirstHomeCompletePaint = jest.fn();
const prefetchAdjacentPeriods = jest.fn(() => jest.fn());

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
});
