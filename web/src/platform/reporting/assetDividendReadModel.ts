import { getClientSessionScope } from '@/composition/clientSessionScope';
import {
  getAllStockHoldings,
  getDividendEventsByYear,
  getDividendSnapshot,
  type DividendEventRecord,
  type DividendSnapshotData,
} from '@/lib/assetService';
import type { StockHolding } from '@/types/asset';
import { assetStatisticsSessionKey } from './assetStatisticsQueryCache';

export interface AssetDividendStatistics {
  readonly allHoldings: StockHolding[];
  readonly snapshot: DividendSnapshotData | null;
  readonly events: DividendEventRecord[];
}

export interface AssetDividendPrefetch {
  readonly year: number;
  readonly result: Promise<AssetDividendStatistics>;
}

/** All independent dividend inputs must complete for the same verified actor. */
export async function readAssetDividendStatistics(
  year: number,
  assertCurrentSource: () => void = () => {},
): Promise<AssetDividendStatistics> {
  const scope = getClientSessionScope();
  if (!scope) throw new Error('STATISTICS_SESSION_CHANGED');
  const actorKey = assetStatisticsSessionKey(scope);
  const assertCurrent = () => {
    const active = getClientSessionScope();
    if (!active || assetStatisticsSessionKey(active) !== actorKey) {
      throw new Error('STATISTICS_SESSION_CHANGED');
    }
    assertCurrentSource();
  };
  assertCurrent();
  const [allHoldings, snapshot, events] = await Promise.all([
    getAllStockHoldings(),
    getDividendSnapshot(year),
    getDividendEventsByYear(year),
  ]).catch(error => {
    assertCurrent();
    throw error;
  });
  assertCurrent();
  return { allHoldings, snapshot, events };
}
