import type {
  LedgerCommandResult,
  LedgerEvent,
  LedgerTransactionView,
} from "../../domain/model/ledgerTransaction";

export type LedgerRepositoryReadResult<T> =
  | { kind: "ready"; value: T }
  | { kind: "retryable-failure"; code: string };

export interface LedgerCommandRepository {
  findReceipt(commandId: string): Promise<LedgerCommandResult | undefined>;
  findTransaction(
    transactionId: string,
  ): Promise<LedgerRepositoryReadResult<LedgerTransactionView | undefined>>;
  listTransactions(
    householdId: string,
  ): Promise<LedgerRepositoryReadResult<readonly LedgerTransactionView[]>>;
  commit(input: {
    commandId: string;
    householdId: string;
    occurredAt: string;
    transaction: LedgerTransactionView;
    event: LedgerEvent;
    result: Extract<LedgerCommandResult, { kind: "success" }>;
  }): Promise<
    | { kind: "success"; replayedResult?: LedgerCommandResult }
    | { kind: "retryable-failure"; code: string }
  >;
}

export interface LedgerClock {
  now(): string;
}

export interface LedgerTransactionIdGenerator {
  next(commandId: string): string;
}

export interface LedgerCategoryUsagePolicy {
  isUsable(categoryId: string): boolean;
}
