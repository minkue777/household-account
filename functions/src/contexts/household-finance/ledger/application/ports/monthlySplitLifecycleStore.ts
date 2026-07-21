import type {
  SplitLifecycleResult,
  SplitTransaction,
} from "../../domain/model/monthlySplitLifecycle";

export interface MonthlySplitLifecycleStore {
  findReceipt(operationKey: string): Promise<SplitLifecycleResult | undefined>;
  load(): Promise<readonly SplitTransaction[]>;
  replaceAtomically(input: {
    operationKey: string;
    transactions: readonly SplitTransaction[];
    intendedWriteCount: number;
    result: Extract<SplitLifecycleResult, { kind: "success" }>;
  }): Promise<
    | { kind: "success" }
    | { kind: "retryable-failure"; code: string }
  >;
}
