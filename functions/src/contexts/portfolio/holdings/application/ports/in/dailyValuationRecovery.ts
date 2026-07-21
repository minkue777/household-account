import type {
  DailyValuationRecoveryEvent,
  DailyValuationRecoveryRunView,
  NormalizedValuationAsset,
  RunDailyValuationRecoveryCommand,
} from "../../../domain/model/dailyValuationRecovery";

export interface DailyValuationRecovery {
  run(
    command: RunDailyValuationRecoveryCommand,
  ): Promise<DailyValuationRecoveryRunView>;
  currentAssets(): readonly NormalizedValuationAsset[];
  recordedEvents(): readonly DailyValuationRecoveryEvent[];
}
