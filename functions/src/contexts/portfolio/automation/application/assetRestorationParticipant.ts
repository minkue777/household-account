import type {
  AssetAutomationRestorationResult,
  AssetAutomationRestorationState,
  DueMonthsResult,
} from "../domain/model/assetAutomationRestoration";
import {
  listDueMonthsPolicy,
  prepareAssetAutomationRestorationPolicy,
} from "../domain/policies/assetAutomationRestoration";

function isRestorationState(
  value: unknown,
): value is AssetAutomationRestorationState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AssetAutomationRestorationState>;
  return (
    typeof candidate.assetId === "string" &&
    typeof candidate.configuredDay === "number" &&
    Array.isArray(candidate.pendingMonths) &&
    Array.isArray(candidate.suspensionIntervals) &&
    Array.isArray(candidate.resumeRevisions)
  );
}

/** RestoreAssetWorkflow 조립부에서만 주입하는 Automation 내부 participant입니다. */
export interface AssetRestorationAutomationParticipant {
  prepare(input: {
    readonly assetId: string;
    readonly deletedAt?: string;
    readonly restoredOn: string;
    readonly state?: unknown;
  }): AssetAutomationRestorationResult;
  listDueMonths(input: {
    readonly state?: unknown;
    readonly assetLifecycle: "active" | "deleted" | "purging";
    readonly asOfDate: string;
  }): DueMonthsResult;
}

export function createAssetRestorationAutomationParticipant(): AssetRestorationAutomationParticipant {
  return {
    prepare(input) {
      if (input.state !== undefined && !isRestorationState(input.state)) {
        return {
          kind: "validation-error",
          code: "INVALID_AUTOMATION_RESTORATION_STATE",
        };
      }
      return prepareAssetAutomationRestorationPolicy({
        assetId: input.assetId,
        ...(input.deletedAt === undefined
          ? {}
          : { deletedAt: input.deletedAt }),
        restoredOn: input.restoredOn,
        ...(input.state === undefined ? {} : { state: input.state }),
      });
    },
    listDueMonths(input) {
      if (input.state !== undefined && !isRestorationState(input.state)) {
        return {
          kind: "validation-error",
          code: "INVALID_AUTOMATION_RESTORATION_STATE",
        };
      }
      return listDueMonthsPolicy({
        ...(input.state === undefined ? {} : { state: input.state }),
        assetLifecycle: input.assetLifecycle,
        asOfDate: input.asOfDate,
      });
    },
  };
}
