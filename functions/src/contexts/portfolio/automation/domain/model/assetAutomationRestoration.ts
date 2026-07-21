export interface AutomationSuspensionInterval {
  readonly startsOn: string;
  readonly endsBefore: string;
}

export interface AutomationResumeRevision {
  readonly revision: number;
  readonly restoredOn: string;
  readonly resumeFromDate: string;
}

/** 복구 Workflow UoW 안에서 Automation participant가 소유하는 snapshot입니다. */
export interface AssetAutomationRestorationState {
  readonly assetId: string;
  readonly configuredDay: number;
  readonly pendingMonths: readonly string[];
  readonly suspensionIntervals: readonly AutomationSuspensionInterval[];
  readonly resumeRevisions: readonly AutomationResumeRevision[];
}

export type AssetAutomationRestorationResult =
  | {
      readonly kind: "prepared";
      readonly nextState?: AssetAutomationRestorationState;
      readonly resumeFromDate?: string;
    }
  | { readonly kind: "validation-error"; readonly code: string };

export type DueMonthsResult =
  | { readonly kind: "success"; readonly months: readonly string[] }
  | { readonly kind: "validation-error"; readonly code: string };
