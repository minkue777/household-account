import type {
  LedgerTransformationResult,
  LedgerTransformationState,
} from "../../domain/model/transformationLineage";

export interface TransformationLineageStore {
  findReceipt(operationKey: string): Promise<LedgerTransformationResult | undefined>;
  load(): Promise<LedgerTransformationState>;
  commit(input: {
    operationKey: string;
    expectedVersions: Readonly<Record<string, number>>;
    state: LedgerTransformationState;
    result: Extract<LedgerTransformationResult, { kind: "success" }>;
  }): Promise<
    | { kind: "success" }
    | { kind: "conflict"; code: "VERSION_MISMATCH" }
    | { kind: "retryable-failure"; code: "LEDGER_UOW_COMMIT_FAILED" }
  >;
}

export interface TransformationLineageClock {
  now(): string;
}
