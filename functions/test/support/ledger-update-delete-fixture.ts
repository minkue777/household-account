import { createLedgerUpdateDeleteCommands } from "../../src/contexts/household-finance/ledger/application/commands/updateDeleteLifecycleService";
import type { LedgerUpdateDeleteStore } from "../../src/contexts/household-finance/ledger/application/ports/updateDeleteStore";
import type {
  LedgerUpdateDeleteResult,
  LedgerUpdateDeleteSnapshot,
  MutableLedgerTransaction,
} from "../../src/contexts/household-finance/ledger/domain/model/updateDeleteLifecycle";

function clone(snapshot: LedgerUpdateDeleteSnapshot): LedgerUpdateDeleteSnapshot {
  return {
    transactions: snapshot.transactions.map((transaction) => ({ ...transaction })),
    events: snapshot.events.map((event) => ({ ...event })),
  };
}

export function createLedgerUpdateDeleteFixtureSubject(fixture: {
  transactions: readonly MutableLedgerTransaction[];
  failNextCommit?: boolean;
}) {
  let snapshot = clone({ transactions: fixture.transactions, events: [] });
  const receipts = new Map<string, LedgerUpdateDeleteResult>();
  let failNextCommit = fixture.failNextCommit ?? false;
  const store: LedgerUpdateDeleteStore = {
    findReceipt: async (commandId) => receipts.get(commandId),
    load: async () => clone(snapshot),
    commit: async ({
      commandId,
      transactionId,
      expectedVersion,
      snapshot: next,
      result,
    }) => {
      if (failNextCommit) {
        failNextCommit = false;
        return { kind: "RetryableFailure", code: "LEDGER_COMMIT_FAILED" };
      }
      const current = snapshot.transactions.find(
        (transaction) => transaction.transactionId === transactionId,
      );
      if (current?.aggregateVersion !== expectedVersion) {
        return {
          kind: "Conflict",
          code: "VERSION_MISMATCH",
          currentVersion: current?.aggregateVersion ?? expectedVersion,
        };
      }
      snapshot = clone(next);
      receipts.set(commandId, result);
      return { kind: "success" };
    },
  };
  const commands = createLedgerUpdateDeleteCommands({ store });
  return {
    ...commands,
    snapshot: () => clone(snapshot),
  };
}
