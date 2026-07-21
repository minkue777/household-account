import { createLocalCurrencyLedgerCommands } from "../../src/contexts/household-finance/ledger/application/commands/localCurrencyLedgerService";
import type { LocalCurrencyLedgerStore } from "../../src/contexts/household-finance/ledger/application/ports/localCurrencyLedgerStore";
import type {
  LocalCurrencyLedgerMutationResult,
  LocalCurrencyLedgerRow,
  LocalCurrencyLedgerState,
} from "../../src/contexts/household-finance/ledger/domain/model/localCurrencyLedger";

function clone(state: LocalCurrencyLedgerState): LocalCurrencyLedgerState {
  return { transactions: state.transactions.map((transaction) => ({ ...transaction })) };
}

export function createLocalCurrencyLedgerFixtureSubject(fixture: {
  transactions: readonly LocalCurrencyLedgerRow[];
}) {
  let state = clone(fixture);
  const receipts = new Map<string, LocalCurrencyLedgerMutationResult>();
  const store: LocalCurrencyLedgerStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    load: async () => clone(state),
    commit: async ({ operationKey, expectedVersions, state: next, result }) => {
      if (
        Object.entries(expectedVersions).some(
          ([transactionId, version]) =>
            state.transactions.find(
              (transaction) => transaction.transactionId === transactionId,
            )?.aggregateVersion !== version,
        )
      ) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      state = clone(next);
      receipts.set(operationKey, result);
      return { kind: "success" };
    },
  };
  const commands = createLocalCurrencyLedgerCommands({ store });
  return {
    ...commands,
    state: () => clone(state),
  };
}
