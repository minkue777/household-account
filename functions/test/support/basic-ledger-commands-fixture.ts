import { createBasicLedgerCommands } from "../../src/contexts/household-finance/ledger/application/commands/basicLedgerService";
import type {
  LedgerCategoryUsagePolicy,
  LedgerCommandRepository,
} from "../../src/contexts/household-finance/ledger/application/ports/basicLedgerRepository";
import type {
  LedgerCommandResult,
  LedgerEvent,
  LedgerTransactionView,
} from "../../src/contexts/household-finance/ledger/domain/model/ledgerTransaction";

export function createBasicLedgerCommandsFixtureSubject(fixture: {
  now: string;
  activeCategoryIds?: readonly string[];
  transactions?: readonly LedgerTransactionView[];
  repositoryFailure?: string;
  failNextWrite?: boolean;
}) {
  let transactions = (fixture.transactions ?? []).map((transaction) => ({
    ...transaction,
    ...(transaction.notificationRequest === undefined
      ? {}
      : { notificationRequest: { ...transaction.notificationRequest } }),
  }));
  const events: LedgerEvent[] = [];
  const receipts = new Map<string, LedgerCommandResult>();
  let failNextWrite = fixture.failNextWrite ?? false;

  const repository: LedgerCommandRepository = {
    findReceipt: async (commandId) => receipts.get(commandId),
    findTransaction: async (transactionId) => {
      if (fixture.repositoryFailure !== undefined) {
        return { kind: "retryable-failure", code: fixture.repositoryFailure };
      }
      return {
        kind: "ready",
        value: transactions.find(
          (transaction) => transaction.transactionId === transactionId,
        ),
      };
    },
    listTransactions: async () => {
      if (fixture.repositoryFailure !== undefined) {
        return { kind: "retryable-failure", code: fixture.repositoryFailure };
      }
      return {
        kind: "ready",
        value: transactions.map((transaction) => ({ ...transaction })),
      };
    },
    commit: async ({ commandId, transaction, event, result }) => {
      if (failNextWrite) {
        failNextWrite = false;
        return { kind: "retryable-failure", code: "LEDGER_COMMIT_FAILED" };
      }
      const index = transactions.findIndex(
        (candidate) => candidate.transactionId === transaction.transactionId,
      );
      if (index === -1) transactions.push({ ...transaction });
      else transactions[index] = { ...transaction };
      events.push({ ...event });
      receipts.set(commandId, {
        kind: "success",
        value: { ...result.value },
      });
      return { kind: "success" };
    },
  };
  const categories: LedgerCategoryUsagePolicy = {
    isUsable: (categoryId) =>
      fixture.activeCategoryIds === undefined ||
      fixture.activeCategoryIds.includes(categoryId),
  };
  const commands = createBasicLedgerCommands({
    repository,
    categories,
    clock: { now: () => fixture.now },
    idGenerator: { next: (commandId) => `transaction:${commandId}` },
  });
  return {
    ...commands,
    state: () => ({
      transactions: transactions.map((transaction) => ({ ...transaction })),
      events: events.map((event) => ({ ...event })),
    }),
  };
}
