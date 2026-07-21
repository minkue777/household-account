import type {
  AssetSnapshotIntentView,
  DailyAssetValuationChangedEvent,
  DailyTargetValuationResult,
  DailyValuationRunView,
  DailyValuationTarget,
} from "../../../domain/model/dailyAssetValuation";

export interface DailyValuationTargetReader {
  listAll(householdId?: string): Promise<readonly DailyValuationTarget[]>;
  previousSnapshotScopes(): {
    byType: Readonly<Record<string, number>>;
    byOwnerRefKey: Readonly<Record<string, number>>;
  } | undefined;
}

export interface DailyValuationProvider {
  value(target: DailyValuationTarget): Promise<DailyTargetValuationResult>;
}

export interface DailyAssetValuationClock {
  now(): string;
}

export interface DailyAssetValuationStore {
  findByIdempotencyKey(key: string): DailyValuationRunView | undefined;
  findRecentPageRun(input: {
    householdId: string;
    requestedAt: string;
    withinMilliseconds: number;
  }): DailyValuationRunView | undefined;
  commit(input: {
    run: DailyValuationRunView;
    idempotencyKey?: string;
    pageEntry?: { householdId: string; requestedAt: string };
    assetValues: Readonly<Record<string, number>>;
    snapshot: AssetSnapshotIntentView;
    events: readonly DailyAssetValuationChangedEvent[];
  }): void;
  runs(): readonly DailyValuationRunView[];
  assetValues(): Readonly<Record<string, number>>;
  snapshot(localDate: string): AssetSnapshotIntentView | undefined;
  events(): readonly DailyAssetValuationChangedEvent[];
}
