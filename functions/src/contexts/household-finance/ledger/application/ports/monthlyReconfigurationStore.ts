import type {
  MonthlyReconfigurationResult,
  MonthlyReconfigurationTransaction,
} from "../../domain/model/monthlyReconfiguration";

export interface MonthlyReconfigurationStore {
  findReceipt(
    operationKey: string,
  ): Promise<MonthlyReconfigurationResult | undefined>;
  load(): Promise<readonly MonthlyReconfigurationTransaction[]>;
  commit(input: {
    operationKey: string;
    expectedVersions: Readonly<Record<string, number>>;
    transactions: readonly MonthlyReconfigurationTransaction[];
    result: Extract<MonthlyReconfigurationResult, { kind: "Reconfigured" }>;
  }): Promise<
    | { kind: "success" }
    | { kind: "Conflict"; code: string }
    | { kind: "RetryableFailure"; code: string }
  >;
}
