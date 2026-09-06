'use client';

import { useEffect, useState } from 'react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { collection, db, doc, onSnapshot } from '@/platform/read-model/firestoreReadModel';
import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import { DEFAULT_HOME_SUMMARY_CONFIG, type HomeSummaryCardKey, type HomeSummaryConfig } from '@/types/household';

export const HOME_CARD_LABELS: Record<HomeSummaryCardKey, string> = {
  localCurrencyBalance: '지역화폐 잔액', monthlyRemainingBudget: '월 잔여 예산', monthlySpent: '월 지출', yearlySpent: '연 지출',
};
const canonical: Record<string, HomeSummaryCardKey> = {
  LOCAL_CURRENCY_BALANCE: 'localCurrencyBalance', MONTHLY_REMAINING_BUDGET: 'monthlyRemainingBudget',
  MONTHLY_EXPENSE: 'monthlySpent', YEARLY_EXPENSE: 'yearlySpent',
};
export const homePreferenceCommands = {
  saveCards(householdId: string, configuration: HomeSummaryConfig, expectedVersion: number) {
    return getHouseholdCommandClient().execute('home.update-summary-preferences.v1', { ...configuration, expectedVersion }, { householdId });
  },
  selectCurrency(householdId: string, localCurrencyTypeId: string, expectedVersion: number) {
    return getHouseholdCommandClient().execute('home.select-local-currency.v1', { localCurrencyTypeId, expectedVersion }, { householdId });
  },
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
    const unsubscribe = onSnapshot(doc(db, 'households', householdKey, 'homePreferences', 'home'), value => {
      if (!active) return;
      const data = value.exists() ? value.data() : {};
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

export function useAvailableHomeCurrencies(householdId: string | null) {
  const [types, setTypes] = useState<string[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    setTypes([]);
    setError(false);
    if (!householdId) return;
    let active = true;
    const unsubscribe = onSnapshot(collection(db, 'households', householdId, 'localCurrencyBalances'), snapshot => {
      if (active) setTypes(Array.from(new Set(snapshot.docs.map(document => document.data().localCurrencyType ?? document.id)
        .filter((value): value is string => typeof value === 'string' && value !== 'legacy-unknown'))).sort());
    }, () => { if (active) setError(true); });
    return () => { active = false; unsubscribe(); };
  }, [householdId]);
  return { types, error };
}
