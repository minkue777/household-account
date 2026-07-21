import { createUnmergeRestorationCommands } from "../../src/contexts/household-finance/ledger/application/commands/unmergeRestorationService";
import type { UnmergeRestorationStore } from "../../src/contexts/household-finance/ledger/application/ports/unmergeRestorationStore";
import type {
  UnmergeRestorationResult,
  UnmergeTransaction,
} from "../../src/contexts/household-finance/ledger/domain/model/unmergeRestoration";

function copy(transaction: UnmergeTransaction): UnmergeTransaction {
  return {
    ...transaction,
    ...(transaction.mergeLeafSnapshots === undefined
      ? {}
      : {
          mergeLeafSnapshots: transaction.mergeLeafSnapshots.map((leaf) => ({
            ...leaf,
          })),
        }),
  };
}

export function createUnmergeRestorationFixtureSubject(fixture: {
  transactions: readonly UnmergeTransaction[];
}) {
  let transactions = fixture.transactions.map(copy);
  const receipts = new Map<string, UnmergeRestorationResult>();
  const store: UnmergeRestorationStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    load: async () => transactions.map(copy),
    commit: async ({
      operationKey,
      expectedVersion,
      mergedTransactionId,
      transactions: next,
      result,
    }) => {
      const current = transactions.find(
        (transaction) => transaction.transactionId === mergedTransactionId,
      );
      if (current?.aggregateVersion !== expectedVersion) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      transactions = next.map(copy);
      receipts.set(operationKey, result);
      return { kind: "success" };
    },
  };
  const commands = createUnmergeRestorationCommands({ store });
  return {
    ...commands,
    snapshot: () => transactions.map(copy),
  };
}
