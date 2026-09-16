import { useEffect, useState } from 'react';
import type { CryptoHolding, StockHolding } from '@/types/asset';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import { registerClientSessionReset } from '@/composition/clientSessionResetRegistry';
import {
  subscribeToHouseholdCryptoHoldings,
  subscribeToHouseholdStockHoldings,
} from '@/lib/assetService';

export interface HouseholdHoldingSnapshots {
  stockHoldings: readonly StockHolding[];
  cryptoHoldings: readonly CryptoHolding[];
  stockHoldingsReady: boolean;
  cryptoHoldingsReady: boolean;
}

interface HouseholdHoldingSnapshot extends HouseholdHoldingSnapshots {
  sessionKey: string;
  generation: number;
}

// This screen retains only the active actor's last snapshot, not a household history.
let cachedSnapshot: HouseholdHoldingSnapshot | undefined;
let generation = 0;
const resetSubscriptions = new Set<() => void>();

function resetSnapshots(): void {
  cachedSnapshot = undefined;
  generation += 1;
  resetSubscriptions.forEach(reset => reset());
}
registerClientSessionReset(resetSnapshots);

function activeSessionKey(householdId: string | undefined): string {
  const scope = getClientSessionScope();
  return !scope || scope.householdId !== householdId ? '' : JSON.stringify([
    scope.principalUid, scope.householdId, scope.memberId,
    scope.sessionGeneration, scope.accessMode ?? 'member',
  ]);
}

function emptySnapshot(sessionKey: string): HouseholdHoldingSnapshot {
  return { sessionKey, generation, stockHoldings: [], cryptoHoldings: [],
    stockHoldingsReady: false, cryptoHoldingsReady: false };
}

function currentSnapshot(sessionKey: string): HouseholdHoldingSnapshot {
  return cachedSnapshot?.sessionKey === sessionKey && cachedSnapshot.generation === generation
    ? cachedSnapshot : emptySnapshot(sessionKey);
}

/** 종류별 listener 하나를 사용하고 같은 인증 세션의 화면 재방문에만 snapshot을 재사용합니다. */
export function useHouseholdHoldingSnapshots(
  householdId: string | undefined,
  enabled: boolean,
  remoteReadEpoch = 0
): HouseholdHoldingSnapshots {
  const sessionKey = activeSessionKey(householdId);
  const [snapshot, setSnapshot] = useState<HouseholdHoldingSnapshot>(() => currentSnapshot(sessionKey));

  useEffect(() => {
    if (!enabled || !sessionKey) return undefined;
    setSnapshot(currentSnapshot(sessionKey));
    const startedGeneration = generation;
    let active = true;
    let unsubscribeStock = () => {};
    let unsubscribeCrypto = () => {};
    const isCurrent = () => active && startedGeneration === generation
      && activeSessionKey(householdId) === sessionKey;
    const dispose = () => {
      if (!active) return;
      active = false;
      unsubscribeStock();
      unsubscribeCrypto();
    };
    const reset = () => { dispose(); setSnapshot(emptySnapshot('')); };
    resetSubscriptions.add(reset);
    try {
      unsubscribeStock = subscribeToHouseholdStockHoldings(stockHoldings => {
        if (!isCurrent()) return;
        const next = { ...currentSnapshot(sessionKey), stockHoldings, stockHoldingsReady: true };
        cachedSnapshot = next;
        setSnapshot(next);
      });
      unsubscribeCrypto = subscribeToHouseholdCryptoHoldings(cryptoHoldings => {
        if (!isCurrent()) return;
        const next = { ...currentSnapshot(sessionKey), cryptoHoldings, cryptoHoldingsReady: true };
        cachedSnapshot = next;
        setSnapshot(next);
      });
    } catch {
      // A partial subscription setup must release its first listener as well.
      const current = isCurrent();
      dispose();
      if (current) {
        const settled = { ...currentSnapshot(sessionKey), stockHoldingsReady: true, cryptoHoldingsReady: true };
        cachedSnapshot = settled;
        setSnapshot(settled);
      }
    }
    return () => { resetSubscriptions.delete(reset); dispose(); };
  }, [enabled, householdId, sessionKey, remoteReadEpoch]);

  return !sessionKey || snapshot.sessionKey !== sessionKey || snapshot.generation !== generation
    ? emptySnapshot(sessionKey) : snapshot;
}

export function resetHouseholdHoldingSnapshotsForTests(): void {
  resetSnapshots();
}
