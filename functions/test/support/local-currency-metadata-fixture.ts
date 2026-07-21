import { createLocalCurrencyMetadataCommands } from "../../src/contexts/household-finance/ledger/application/commands/localCurrencyMetadataService";
import type { LocalCurrencyMetadataStore } from "../../src/contexts/household-finance/ledger/application/ports/localCurrencyMetadataStore";
import type {
  LocalCurrencyMetadataResult,
  LocalCurrencyMetadataTransaction,
} from "../../src/contexts/household-finance/ledger/domain/model/localCurrencyMetadata";

export function createLocalCurrencyMetadataFixtureSubject(fixture: {
  transactions?: readonly LocalCurrencyMetadataTransaction[];
}) {
  let transactions = (fixture.transactions ?? []).map((transaction) => ({
    ...transaction,
  }));
  const receipts = new Map<string, LocalCurrencyMetadataResult>();
  const store: LocalCurrencyMetadataStore = {
    findReceipt: async (commandId) => receipts.get(commandId),
    load: async () => transactions.map((transaction) => ({ ...transaction })),
    commit: async ({ commandId, expectedVersion, transactions: next, result }) => {
      if (expectedVersion !== undefined) {
        const current = transactions.find(
          (transaction) =>
            transaction.transactionId === expectedVersion.transactionId,
        );
        if (current?.aggregateVersion !== expectedVersion.version) {
          return { kind: "Conflict", code: "VERSION_MISMATCH" };
        }
      }
      transactions = next.map((transaction) => ({ ...transaction }));
      receipts.set(commandId, result);
      return { kind: "success" };
    },
  };
  const commands = createLocalCurrencyMetadataCommands({
    store,
    idGenerator: { next: (commandId) => `transaction:${commandId}` },
  });
  return {
    ...commands,
    snapshot: () => transactions.map((transaction) => ({ ...transaction })),
  };
}
