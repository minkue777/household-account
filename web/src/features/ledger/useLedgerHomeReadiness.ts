'use client';

import { useEffect, useLayoutEffect } from 'react';
import {
  markWebFirstHomeCompletePaint, markWebFirstLedgerPaint, markWebLedgerCacheResult,
  markWebHomeReadiness,
  scheduleAfterWebFirstHomeCompletePaint,
} from '@/platform/performance/webStartupPerformance';

function usePaintWhenReady(ready: boolean, mark: () => void) {
  useEffect(() => {
    if (!ready) return;
    let firstFrame: number | undefined;
    let paintedFrame: number | undefined;
    let fallback: number | undefined;
    if (typeof window.requestAnimationFrame === 'function') {
      firstFrame = window.requestAnimationFrame(() => { paintedFrame = window.requestAnimationFrame(mark); });
    } else {
      fallback = window.setTimeout(mark, 0);
    }
    return () => {
      if (firstFrame !== undefined) window.cancelAnimationFrame(firstFrame);
      if (paintedFrame !== undefined) window.cancelAnimationFrame(paintedFrame);
      if (fallback !== undefined) window.clearTimeout(fallback);
    };
  }, [ready, mark]);
}

/** 계측과 사전 조회만 조정하며 표시 데이터나 화면 이동 상태는 수정하지 않습니다. */
export function useLedgerHomeReadiness(input: {
  periodKey: string;
  ledgerReady: boolean;
  categoriesLoading: boolean;
  categoriesReady: boolean;
  currencySettled: boolean;
  currencyReady: boolean;
  yearSummaryReady: boolean;
  yearSummaryRequired: boolean;
  readRefreshKey: string;
  prefetchAdjacentPeriods: () => () => void;
}) {
  const { periodKey, ledgerReady, categoriesLoading, categoriesReady, currencySettled,
    currencyReady, yearSummaryReady, yearSummaryRequired, readRefreshKey, prefetchAdjacentPeriods } = input;
  useLayoutEffect(() => { markWebLedgerCacheResult(false); }, [periodKey]);
  useLayoutEffect(() => {
    markWebHomeReadiness({ ledgerReady, categoriesReady, currencyReady, yearSummaryReady, yearSummaryRequired });
  }, [ledgerReady, categoriesReady, currencyReady, yearSummaryReady, yearSummaryRequired]);
  usePaintWhenReady(ledgerReady, markWebFirstLedgerPaint);
  usePaintWhenReady(ledgerReady && categoriesReady && currencyReady && yearSummaryReady, markWebFirstHomeCompletePaint);
  useEffect(() => {
    if (!ledgerReady || categoriesLoading || !currencySettled) return;
    let cancelPrefetch: (() => void) | undefined;
    const cancelScheduled = scheduleAfterWebFirstHomeCompletePaint(() => {
      cancelPrefetch = prefetchAdjacentPeriods();
    }, { fallbackMs: 15_000 });
    return () => { cancelScheduled(); cancelPrefetch?.(); };
  }, [ledgerReady, categoriesLoading, currencySettled, readRefreshKey, prefetchAdjacentPeriods]);
}
