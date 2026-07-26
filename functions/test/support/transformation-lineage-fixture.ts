import { createLedgerTransformationCommands } from "../../src/contexts/household-finance/ledger/application/commands/transformationLineageService";
import type {
  TransformationLineageSelection,
  TransformationLineageStore,
} from "../../src/contexts/household-finance/ledger/application/ports/transformationLineageStore";
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

function selectState(
  state: LedgerTransformationState,
  selection: TransformationLineageSelection,
): LedgerTransformationState {
  const transactionIds = new Set(selection.transactionIds ?? []);
  const captureLineageIds = new Set(selection.captureLineageIds ?? []);
  const mergeLeafIds = new Set(selection.mergeLeafIds ?? []);
  return cloneState({
    transactions: state.transactions.filter(
      (transaction) =>
        transactionIds.has(transaction.transactionId) ||
        captureLineageIds.has(transaction.provenance.captureLineageId) ||
        transaction.mergeLeafIds?.some((leafId) => mergeLeafIds.has(leafId)) ===
          true,
    ),
    dedupClaims: state.dedupClaims.filter((claim) =>
      captureLineageIds.has(claim.captureLineageId),
    ),
    cancelledLineages: state.cancelledLineages.filter((entry) =>
      captureLineageIds.has(entry.captureLineageId),
    ),
  });
}

function sameState(
  left: LedgerTransformationState,
  right: LedgerTransformationState,
): boolean {
  const normalize = (value: LedgerTransformationState) => ({
    transactions: [...value.transactions].sort((a, b) =>
      a.transactionId.localeCompare(b.transactionId),
    ),
    dedupClaims: [...value.dedupClaims].sort((a, b) =>
      a.captureLineageId.localeCompare(b.captureLineageId),
    ),
    cancelledLineages: [...value.cancelledLineages].sort((a, b) =>
      a.captureLineageId.localeCompare(b.captureLineageId),
    ),
  });
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
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
  const selections: TransformationLineageSelection[] = [];
  let failNextCommit = false;
  let commitTail: Promise<void> = Promise.resolve();

  const store: TransformationLineageStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    hasIncompleteLegacyMergeSnapshot: async () =>
      state.transactions.some(
        (transaction) =>
          transaction.lifecycleState !== "deleted" &&
          transaction.legacyMergeSnapshotPresent === true &&
          (transaction.mergeLeafIds === undefined ||
            transaction.mergeLeafIds.length === 0),
      ),
    load: async (selection) => {
      selections.push({
        ...(selection.transactionIds === undefined
          ? {}
          : { transactionIds: [...selection.transactionIds] }),
        ...(selection.captureLineageIds === undefined
          ? {}
          : { captureLineageIds: [...selection.captureLineageIds] }),
        ...(selection.mergeLeafIds === undefined
          ? {}
          : { mergeLeafIds: [...selection.mergeLeafIds] }),
      });
      return selectState(state, selection);
    },
    commit: async ({
      operationKey,
      expectedVersions,
      selection,
      baseline,
      state: next,
      result,
      requireCompleteMergeLineage,
    }) => {
      let outcome:
        | { kind: "success" }
        | { kind: "conflict"; code: "VERSION_MISMATCH" }
        | {
            kind: "contract-failure";
            code: "RESTORATION_SNAPSHOT_INCOMPLETE";
          }
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
        if (
          requireCompleteMergeLineage === true &&
          state.transactions.some(
            (transaction) =>
              transaction.lifecycleState !== "deleted" &&
              transaction.legacyMergeSnapshotPresent === true &&
              (transaction.mergeLeafIds === undefined ||
                transaction.mergeLeafIds.length === 0),
          )
        ) {
          outcome = {
            kind: "contract-failure",
            code: "RESTORATION_SNAPSHOT_INCOMPLETE",
          };
          return;
        }
        const baselineIds = new Set(
          baseline.transactions.map((transaction) => transaction.transactionId),
        );
        const newIds = next.transactions
          .filter((transaction) => !baselineIds.has(transaction.transactionId))
          .map((transaction) => transaction.transactionId);
        const guardedSelection = {
          ...selection,
          transactionIds: [
            ...(selection.transactionIds ?? []),
            ...newIds,
          ],
        };
        if (!sameState(baseline, selectState(state, guardedSelection))) {
          outcome = { kind: "conflict", code: "VERSION_MISMATCH" };
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
        const nextTransactions = new Map(
          state.transactions.map((transaction) => [
            transaction.transactionId,
            cloneTransaction(transaction),
          ]),
        );
        const selectedNextIds = new Set(
          next.transactions.map((transaction) => transaction.transactionId),
        );
        baseline.transactions.forEach((transaction) => {
          if (!selectedNextIds.has(transaction.transactionId)) {
            nextTransactions.delete(transaction.transactionId);
          }
        });
        next.transactions.forEach((transaction) => {
          nextTransactions.set(transaction.transactionId, cloneTransaction(transaction));
        });

        const nextClaims = new Map(
          state.dedupClaims.map((claim) => [claim.captureLineageId, { ...claim }]),
        );
        next.dedupClaims.forEach((claim) => {
          nextClaims.set(claim.captureLineageId, { ...claim });
        });
        const nextCancelled = new Map(
          state.cancelledLineages.map((entry) => [
            entry.captureLineageId,
            { ...entry },
          ]),
        );
        next.cancelledLineages.forEach((entry) => {
          nextCancelled.set(entry.captureLineageId, { ...entry });
        });
        state = cloneState({
          transactions: [...nextTransactions.values()],
          dedupClaims: [...nextClaims.values()],
          cancelledLineages: [...nextCancelled.values()],
        });
        receipts.set(operationKey, {
          ...result,
          transactionIds: [...result.transactionIds],
          ...(result.transactions === undefined
            ? {}
            : {
                transactions: result.transactions.map(cloneTransaction),
              }),
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
    loadSelections: () => selections.map((selection) => ({ ...selection })),
  };
}
