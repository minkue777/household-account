import { createLedgerTransformationCommands } from "../../src/contexts/household-finance/ledger/application/commands/transformationLineageService";
import type { TransformationLineageStore } from "../../src/contexts/household-finance/ledger/application/ports/transformationLineageStore";
import type {
  LedgerTransformationResult,
  LedgerTransformationState,
  LedgerTransformationTransaction,
} from "../../src/contexts/household-finance/ledger/domain/model/transformationLineage";

function cloneTransaction(
  transaction: LedgerTransformationTransaction,
): LedgerTransformationTransaction {
  return {
    ...transaction,
    provenance: { ...transaction.provenance },
    ...(transaction.mergeLeafIds === undefined
      ? {}
      : { mergeLeafIds: [...transaction.mergeLeafIds] }),
    ...(transaction.intermediateMergeHistoryIds === undefined
      ? {}
      : {
          intermediateMergeHistoryIds: [
            ...transaction.intermediateMergeHistoryIds,
          ],
        }),
  };
}

function cloneState(state: LedgerTransformationState): LedgerTransformationState {
  return {
    transactions: state.transactions.map(cloneTransaction),
    dedupClaims: state.dedupClaims.map((claim) => ({ ...claim })),
    cancelledLineages: state.cancelledLineages.map((entry) => ({ ...entry })),
  };
}

export function createTransformationLineageFixtureSubject(fixture: {
  transactions: readonly LedgerTransformationTransaction[];
  dedupClaims: LedgerTransformationState["dedupClaims"];
}) {
  let state: LedgerTransformationState = cloneState({
    transactions: fixture.transactions,
    dedupClaims: fixture.dedupClaims,
    cancelledLineages: [],
  });
  const receipts = new Map<string, LedgerTransformationResult>();
  let failNextCommit = false;
  let commitTail: Promise<void> = Promise.resolve();

  const store: TransformationLineageStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    load: async () => cloneState(state),
    commit: async ({ operationKey, expectedVersions, state: next, result }) => {
      let outcome:
        | { kind: "success" }
        | { kind: "conflict"; code: "VERSION_MISMATCH" }
        | { kind: "retryable-failure"; code: "LEDGER_UOW_COMMIT_FAILED" } = {
        kind: "success",
      };
      const run = commitTail.then(() => {
        if (failNextCommit) {
          failNextCommit = false;
          outcome = {
            kind: "retryable-failure",
            code: "LEDGER_UOW_COMMIT_FAILED",
          };
          return;
        }
        const mismatch = Object.entries(expectedVersions).some(
          ([transactionId, expectedVersion]) =>
            state.transactions.find(
              (transaction) => transaction.transactionId === transactionId,
            )?.aggregateVersion !== expectedVersion,
        );
        if (mismatch) {
          outcome = { kind: "conflict", code: "VERSION_MISMATCH" };
          return;
        }
        state = cloneState(next);
        receipts.set(operationKey, {
          ...result,
          transactionIds: [...result.transactionIds],
        });
      });
      commitTail = run;
      await run;
      return outcome;
    },
  };
  const commands = createLedgerTransformationCommands({
    store,
    clock: { now: () => "2026-07-20T00:00:00+09:00" },
  });
  return {
    ...commands,
    failNextCommitAtBoundary: () => {
      failNextCommit = true;
    },
    state: () => cloneState(state),
  };
}
