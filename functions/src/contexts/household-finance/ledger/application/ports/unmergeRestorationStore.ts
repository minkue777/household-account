import type {
  UnmergeRestorationResult,
  UnmergeTransaction,
} from "../../domain/model/unmergeRestoration";

export interface UnmergeRestorationStore {
  findReceipt(operationKey: string): Promise<UnmergeRestorationResult | undefined>;
  load(): Promise<readonly UnmergeTransaction[]>;
  commit(input: {
    operationKey: string;
    expectedVersion: number;
    mergedTransactionId: string;
    transactions: readonly UnmergeTransaction[];
    result: Extract<UnmergeRestorationResult, { kind: "Unmerged" }>;
  }): Promise<
    | { kind: "success" }
    | { kind: "Conflict"; code: string }
    | { kind: "RetryableFailure"; code: string }
  >;
}
