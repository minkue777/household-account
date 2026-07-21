import type {
  MergeIntegrityResult,
  MergeIntegritySnapshot,
} from "../../domain/model/mergeIntegrity";

export interface MergeIntegrityStore {
  findReceipt(operationKey: string): Promise<MergeIntegrityResult | undefined>;
  load(): Promise<MergeIntegritySnapshot>;
  commit(input: {
    operationKey: string;
    snapshot: MergeIntegritySnapshot;
    result: Extract<MergeIntegrityResult, { kind: "Merged" }>;
  }): Promise<
    | { kind: "success" }
    | { kind: "RetryableFailure"; code: "LEDGER_UOW_COMMIT_FAILED" }
  >;
}
