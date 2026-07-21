import type {
  AssetSnapshotIntentView,
  DailyAssetValuationChangedEvent,
  DailyValuationRunView,
  RunDailyAssetValuationCommand,
} from "../../../domain/model/dailyAssetValuation";

export interface DailyAssetValuation {
  run(command: RunDailyAssetValuationCommand): Promise<DailyValuationRunView>;
  listRuns(): readonly DailyValuationRunView[];
  currentAssetValues(): Readonly<Record<string, number>>;
  snapshotIntent(localDate: string): AssetSnapshotIntentView | undefined;
  recordedEvents(): readonly DailyAssetValuationChangedEvent[];
}
