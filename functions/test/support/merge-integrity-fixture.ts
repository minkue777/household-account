import { createMergeIntegrityCommands } from "../../src/contexts/household-finance/ledger/application/commands/mergeIntegrityService";
import type { MergeIntegrityStore } from "../../src/contexts/household-finance/ledger/application/ports/mergeIntegrityStore";
import type {
  MergeIntegrityResult,
  MergeIntegritySnapshot,
  MergeTransaction,
} from "../../src/contexts/household-finance/ledger/domain/model/mergeIntegrity";

function cloneTransaction(transaction: MergeTransaction): MergeTransaction {
  return {
    ...transaction,
    ...(transaction.mergeSnapshot === undefined
      ? {}
      : { mergeSnapshot: transaction.mergeSnapshot.map((leaf) => ({ ...leaf })) }),
    ...(transaction.mergeParentIds === undefined
      ? {}
      : { mergeParentIds: [...transaction.mergeParentIds] }),
  };
}

function cloneSnapshot(snapshot: MergeIntegritySnapshot): MergeIntegritySnapshot {
  return {
    transactions: snapshot.transactions.map(cloneTransaction),
    events: snapshot.events.map((event) => ({ ...event })),
  };
}

export function createMergeIntegrityFixtureSubject(fixture: {
  transactions: readonly MergeTransaction[];
  failCommit?: boolean;
}) {
  let snapshot: MergeIntegritySnapshot = {
    transactions: fixture.transactions.map(cloneTransaction),
    events: [],
  };
  const receipts = new Map<string, MergeIntegrityResult>();
  const store: MergeIntegrityStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    load: async () => cloneSnapshot(snapshot),
    commit: async ({ operationKey, snapshot: next, result }) => {
      if (fixture.failCommit) {
        return { kind: "RetryableFailure", code: "LEDGER_UOW_COMMIT_FAILED" };
      }
      snapshot = cloneSnapshot(next);
      receipts.set(operationKey, result);
      return { kind: "success" };
    },
  };
  const commands = createMergeIntegrityCommands({ store });
  return {
    ...commands,
    snapshot: () => cloneSnapshot(snapshot),
  };
}
