import type {
  LocalCurrencyMetadataResult,
  LocalCurrencyMetadataTransaction,
} from "../../domain/model/localCurrencyMetadata";

export interface LocalCurrencyMetadataStore {
  findReceipt(commandId: string): Promise<LocalCurrencyMetadataResult | undefined>;
  load(): Promise<readonly LocalCurrencyMetadataTransaction[]>;
  commit(input: {
    commandId: string;
    expectedVersion?: { transactionId: string; version: number };
    transactions: readonly LocalCurrencyMetadataTransaction[];
    result: Extract<
      LocalCurrencyMetadataResult,
      { kind: "Recorded" | "Updated" }
    >;
  }): Promise<
    | { kind: "success" }
    | { kind: "Conflict"; code: "VERSION_MISMATCH" }
  >;
}

export interface LocalCurrencyTransactionIdGenerator {
  next(commandId: string): string;
}
