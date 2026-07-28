import type {
  SplitLifecycleResult,
  SplitTransaction,
} from "../../domain/model/monthlySplitLifecycle";

export interface MonthlySplitLifecycleStore {
  findReceipt(operationKey: string): Promise<SplitLifecycleResult | undefined>;
  load(
    selection:
      | { readonly kind: "transaction"; readonly transactionId: string }
      | { readonly kind: "group"; readonly groupId: string }
      | { readonly kind: "empty" },
  ): Promise<readonly SplitTransaction[]>;
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
