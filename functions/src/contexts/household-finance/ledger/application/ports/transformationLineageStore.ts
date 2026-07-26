import type {
  LedgerTransformationResult,
  LedgerTransformationState,
} from "../../domain/model/transformationLineage";

export interface TransformationLineageSelection {
  readonly transactionIds?: readonly string[];
  readonly captureLineageIds?: readonly string[];
  readonly mergeLeafIds?: readonly string[];
}

export interface TransformationLineageStore {
  findReceipt(operationKey: string): Promise<LedgerTransformationResult | undefined>;
  hasIncompleteLegacyMergeSnapshot(): Promise<boolean>;
  load(selection: TransformationLineageSelection): Promise<LedgerTransformationState>;
  commit(input: {
    operationKey: string;
    expectedVersions: Readonly<Record<string, number>>;
    selection: TransformationLineageSelection;
    baseline: LedgerTransformationState;
    state: LedgerTransformationState;
    result: Extract<LedgerTransformationResult, { kind: "success" }>;
    requireCompleteMergeLineage?: boolean;
  }): Promise<
    | { kind: "success" }
    | { kind: "conflict"; code: "VERSION_MISMATCH" }
    | {
        kind: "contract-failure";
        code: "RESTORATION_SNAPSHOT_INCOMPLETE";
      }
    | { kind: "retryable-failure"; code: "LEDGER_UOW_COMMIT_FAILED" }
  >;
}

export interface TransformationLineageClock {
  now(): string;
}
