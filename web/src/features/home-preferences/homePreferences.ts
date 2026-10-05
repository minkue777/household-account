'use client';

import { subscribeToHomePreferencesDocument } from '@/platform/read-model/homePreferencesReadModel';

import { useEffect, useState } from 'react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { DEFAULT_HOME_SUMMARY_CONFIG, type HomeSummaryCardKey, type HomeSummaryConfig } from '@/types/household';

const canonical: Record<string, HomeSummaryCardKey> = {
  LOCAL_CURRENCY_BALANCE: 'localCurrencyBalance', MONTHLY_REMAINING_BUDGET: 'monthlyRemainingBudget',
  MONTHLY_EXPENSE: 'monthlySpent', YEARLY_EXPENSE: 'yearlySpent',
};
export function useHomePreferences() {
  const { household, householdKey, remoteReadEpoch = 0 } = useHousehold();
  const fallback = household?.homeSummaryConfig ?? DEFAULT_HOME_SUMMARY_CONFIG;
  const [snapshot, setSnapshot] = useState<{ householdId: string; configuration: HomeSummaryConfig; version: number; selectedType?: string }>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!householdKey) return;
    let active = true;
    setError(false);
    const unsubscribe = subscribeToHomePreferencesDocument(householdKey, value => {
      if (!active) return;
      const data = value ?? {};
      setSnapshot({ householdId: householdKey,
        configuration: { leftCard: canonical[data.left] ?? fallback.leftCard, rightCard: canonical[data.right] ?? fallback.rightCard },
        version: Number.isSafeInteger(data.aggregateVersion) ? data.aggregateVersion : household?.homeSummaryConfigVersion ?? 0,
        selectedType: typeof data.selectedLocalCurrencyType === 'string' ? data.selectedLocalCurrencyType : household?.selectedLocalCurrencyType,
      });
      setError(false);
    }, () => { if (active) setError(true); });
    return () => { active = false; unsubscribe(); };
  }, [householdKey, remoteReadEpoch, fallback.leftCard, fallback.rightCard, household?.homeSummaryConfigVersion, household?.selectedLocalCurrencyType]);
  const current = snapshot?.householdId === householdKey ? snapshot : undefined;
  return { configuration: current?.configuration ?? fallback, version: current?.version, selectedType: current?.selectedType ?? household?.selectedLocalCurrencyType, error };
}
