import type {
  LocalCurrencyLedgerMutationResult,
  LocalCurrencyLedgerState,
} from "../../domain/model/localCurrencyLedger";

export interface LocalCurrencyLedgerStore {
  findReceipt(
    operationKey: string,
  ): Promise<LocalCurrencyLedgerMutationResult | undefined>;
  load(): Promise<LocalCurrencyLedgerState>;
  commit(input: {
    operationKey: string;
    expectedVersions: Readonly<Record<string, number>>;
    state: LocalCurrencyLedgerState;
    result: Extract<LocalCurrencyLedgerMutationResult, { kind: "success" }>;
  }): Promise<
    | { kind: "success" }
    | { kind: "conflict"; code: "VERSION_MISMATCH" }
  >;
}
