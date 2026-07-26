import { useEffect, useState } from 'react';
import type { CryptoHolding, StockHolding } from '@/types/asset';
import {
  subscribeToHouseholdCryptoHoldings,
  subscribeToHouseholdStockHoldings,
} from '@/lib/assetService';

interface HouseholdHoldingSnapshot {
  householdId: string;
  stockHoldings: StockHolding[];
  cryptoHoldings: CryptoHolding[];
  stockHoldingsReady: boolean;
  cryptoHoldingsReady: boolean;
}

export interface HouseholdHoldingSnapshots {
  stockHoldings: readonly StockHolding[];
  cryptoHoldings: readonly CryptoHolding[];
  stockHoldingsReady: boolean;
  cryptoHoldingsReady: boolean;
}

const snapshotsByHousehold = new Map<string, HouseholdHoldingSnapshot>();

function emptySnapshot(householdId: string): HouseholdHoldingSnapshot {
  return {
    householdId,
    stockHoldings: [],
    cryptoHoldings: [],
    stockHoldingsReady: false,
    cryptoHoldingsReady: false,
  };
}

function currentSnapshot(householdId: string): HouseholdHoldingSnapshot {
  return snapshotsByHousehold.get(householdId) ?? emptySnapshot(householdId);
}

/**
 * 자산 화면이 살아 있는 동안 가구 전체 보유 종목을 종류별 Firestore listener 하나로 유지합니다.
 * 화면을 다시 방문하면 같은 브라우저 세션의 마지막 snapshot을 첫 렌더부터 재사용합니다.
 */
export function useHouseholdHoldingSnapshots(
  householdId: string | undefined,
  enabled: boolean,
  remoteReadEpoch = 0
): HouseholdHoldingSnapshots {
  const [snapshot, setSnapshot] = useState<HouseholdHoldingSnapshot>(() =>
    householdId ? currentSnapshot(householdId) : emptySnapshot('')
  );

  useEffect(() => {
    if (!enabled || !householdId) return undefined;

    setSnapshot(currentSnapshot(householdId));

    let unsubscribeStock = () => {};
    let unsubscribeCrypto = () => {};
    try {
      unsubscribeStock = subscribeToHouseholdStockHoldings((stockHoldings) => {
        const next = {
          ...currentSnapshot(householdId),
          stockHoldings,
          stockHoldingsReady: true,
        };
        snapshotsByHousehold.set(householdId, next);
        setSnapshot(next);
      });
      unsubscribeCrypto = subscribeToHouseholdCryptoHoldings((cryptoHoldings) => {
        const next = {
          ...currentSnapshot(householdId),
          cryptoHoldings,
          cryptoHoldingsReady: true,
        };
        snapshotsByHousehold.set(householdId, next);
        setSnapshot(next);
      });
    } catch {
      // 인증 복구 epoch가 바뀌면 다시 구독합니다. 그때까지 모달이 영원히
      // loading으로 남지 않도록 현재 cache를 읽기 완료 상태로 정착시킵니다.
      const current = currentSnapshot(householdId);
      const settled = {
        ...current,
        stockHoldingsReady: true,
        cryptoHoldingsReady: true,
      };
      snapshotsByHousehold.set(householdId, settled);
      setSnapshot(settled);
    }

    return () => {
      unsubscribeStock();
      unsubscribeCrypto();
    };
  }, [enabled, householdId, remoteReadEpoch]);

  if (!householdId || snapshot.householdId !== householdId) {
    return emptySnapshot(householdId ?? '');
  }

  return snapshot;
}

export function resetHouseholdHoldingSnapshotsForTests(): void {
  snapshotsByHousehold.clear();
}
