import type {
  DailyValuationRecoveryEvent,
  DailyValuationRecoveryRunView,
  NormalizedValuationAsset,
} from "../../../domain/model/dailyValuationRecovery";

export interface DailyValuationRecoveryStore {
  receipt(runId: string): DailyValuationRecoveryRunView | undefined;
  assets(): readonly NormalizedValuationAsset[];
  commit(input: {
    runId: string;
    result: DailyValuationRecoveryRunView;
    updates: readonly {
      assetId: string;
      expectedVersion: number;
      valueInWon: number;
    }[];
    events: readonly DailyValuationRecoveryEvent[];
  }): "committed" | "version-conflict";
  events(): readonly DailyValuationRecoveryEvent[];
}
