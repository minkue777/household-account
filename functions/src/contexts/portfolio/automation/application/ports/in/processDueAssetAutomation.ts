import type { AssetAutomationPageResult } from "../../../domain/model/assetAutomationRuntime";

export interface ProcessDueAssetAutomation {
  processPage(input: {
    readonly occurrenceId: string;
    readonly asOfDate: string;
    readonly processedAt: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<AssetAutomationPageResult>;
}
