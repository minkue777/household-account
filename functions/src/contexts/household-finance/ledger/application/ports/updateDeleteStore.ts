import type {
  LedgerUpdateDeleteResult,
  LedgerUpdateDeleteSnapshot,
} from "../../domain/model/updateDeleteLifecycle";

export interface LedgerUpdateDeleteStore {
  findReceipt(commandId: string): Promise<LedgerUpdateDeleteResult | undefined>;
  load(): Promise<LedgerUpdateDeleteSnapshot>;
  commit(input: {
    commandId: string;
    transactionId: string;
    expectedVersion: number;
    snapshot: LedgerUpdateDeleteSnapshot;
    result: Extract<LedgerUpdateDeleteResult, { kind: "Updated" | "Deleted" }>;
  }): Promise<
    | { kind: "success" }
    | Extract<
        LedgerUpdateDeleteResult,
        { kind: "Conflict" | "RetryableFailure" }
      >
  >;
}
