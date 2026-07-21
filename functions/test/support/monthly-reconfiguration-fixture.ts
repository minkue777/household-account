import { createMonthlyReconfigurationCommands } from "../../src/contexts/household-finance/ledger/application/commands/monthlyReconfigurationService";
import type { MonthlyReconfigurationStore } from "../../src/contexts/household-finance/ledger/application/ports/monthlyReconfigurationStore";
import type {
  MonthlyReconfigurationResult,
  MonthlyReconfigurationTransaction,
} from "../../src/contexts/household-finance/ledger/domain/model/monthlyReconfiguration";

function copy(
  transaction: MonthlyReconfigurationTransaction,
): MonthlyReconfigurationTransaction {
  return {
    ...transaction,
    ...(transaction.monthlyGroup === undefined
      ? {}
      : { monthlyGroup: { ...transaction.monthlyGroup } }),
  };
}

export function createMonthlyReconfigurationFixtureSubject(fixture: {
  transactions: readonly MonthlyReconfigurationTransaction[];
}) {
  let transactions = fixture.transactions.map(copy);
  const receipts = new Map<string, MonthlyReconfigurationResult>();
  const store: MonthlyReconfigurationStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    load: async () => transactions.map(copy),
    commit: async ({ operationKey, expectedVersions, transactions: next, result }) => {
      if (
        Object.entries(expectedVersions).some(
          ([transactionId, version]) =>
            transactions.find(
              (transaction) => transaction.transactionId === transactionId,
            )?.aggregateVersion !== version,
        )
      ) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      transactions = next.map(copy);
      receipts.set(operationKey, result);
      return { kind: "success" };
    },
  };
  const commands = createMonthlyReconfigurationCommands({ store });
  return {
    ...commands,
    snapshot: () => transactions.map(copy),
  };
}
