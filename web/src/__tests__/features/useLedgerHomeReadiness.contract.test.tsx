import { act, renderHook } from '@testing-library/react';
import { useLedgerHomeReadiness } from '@/features/ledger/useLedgerHomeReadiness';
import {
  markWebHomeReadiness, markWebFirstLedgerPaint, markWebFirstHomeCompletePaint,
} from '@/platform/performance/webStartupPerformance';

jest.mock('@/platform/performance/webStartupPerformance', () => ({
  markWebHomeReadiness: jest.fn(), markWebFirstLedgerPaint: jest.fn(),
  markWebFirstHomeCompletePaint: jest.fn(), markWebLedgerCacheResult: jest.fn(),
  scheduleAfterWebFirstHomeCompletePaint: jest.fn(() => jest.fn()),
}));

describe('ledger home readiness diagnostic timing', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('각 준비 상태는 commit에서 관측하고 전체 준비/두 프레임 조건은 그대로 유지한다', () => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 16));
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => window.clearTimeout(id));
    const input = {
      periodKey: 'expense:2026:9', ledgerReady: false, categoriesLoading: true,
      categoriesReady: false, currencySettled: false, currencyReady: false,
      yearSummaryReady: false, yearSummaryRequired: true, readRefreshKey: 'current',
      prefetchAdjacentPeriods: jest.fn(() => jest.fn()),
    };
    const view = renderHook((props) => useLedgerHomeReadiness(props), { initialProps: input });
    view.rerender({ ...input, categoriesLoading: false, categoriesReady: true });
    expect(markWebHomeReadiness).toHaveBeenLastCalledWith({
      ledgerReady: false, categoriesReady: true, currencyReady: false, yearSummaryReady: false, yearSummaryRequired: true,
    });
    act(() => jest.advanceTimersByTime(100));
    expect(markWebFirstLedgerPaint).not.toHaveBeenCalled();
    expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();
    const loaded = { ...input, ledgerReady: true, categoriesLoading: false, categoriesReady: true, currencyReady: true, currencySettled: true };
    view.rerender(loaded);
    act(() => jest.advanceTimersByTime(32));
    expect(markWebFirstLedgerPaint).toHaveBeenCalledTimes(1);
    expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();
    view.rerender({ ...loaded, yearSummaryReady: true });
    expect(markWebHomeReadiness).toHaveBeenLastCalledWith({
      ledgerReady: true, categoriesReady: true, currencyReady: true, yearSummaryReady: true, yearSummaryRequired: true,
    });
    act(() => jest.advanceTimersByTime(16));
    expect(markWebFirstHomeCompletePaint).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(16));
    expect(markWebFirstHomeCompletePaint).toHaveBeenCalledTimes(1);
    expect(markWebFirstLedgerPaint).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
