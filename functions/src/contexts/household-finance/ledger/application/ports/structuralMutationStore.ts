import type {
  StructuralLedgerState,
  StructuralMutationResult,
} from "../../domain/model/structuralMutation";

export interface StructuralMutationStore {
  load(): Promise<StructuralLedgerState>;
  commit(input: {
    state: StructuralLedgerState;
    result: Extract<StructuralMutationResult, { kind: "Committed" }>;
  }): Promise<
    | { kind: "success" }
    | { kind: "RetryableFailure"; code: "LEDGER_UOW_COMMIT_FAILED" }
  >;
}
