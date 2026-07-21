import type {
  DividendHoldingTargetPage,
  DividendPositionHistoryView,
} from "../../../domain/model/dividendHoldingQuery";

export interface DividendHoldingQuery {
  listActiveKrxEtfTargets(input: {
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<DividendHoldingTargetPage>;

  listPositionHistory(input: {
    readonly householdId: string;
    readonly sourceAssetIds: readonly string[];
    readonly instrumentCode: string;
  }): Promise<readonly DividendPositionHistoryView[]>;
}
