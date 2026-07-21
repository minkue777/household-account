import type { MergeIntegrityStore } from "../ports/mergeIntegrityStore";
import type {
  MergeIntegrityResult,
  MergeTransaction,
} from "../../domain/model/mergeIntegrity";
import {
  flattenMergeLeaves,
  hasMergeAncestryCycle,
} from "../../domain/policies/mergeGraphPolicy";

export interface MergeIntegrityCommands {
  merge(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    targetId: string;
    sourceIds: readonly string[];
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<MergeIntegrityResult>;
}

export function createMergeIntegrityCommands(input: {
  store: MergeIntegrityStore;
}): MergeIntegrityCommands {
  return {
    merge: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const state = await input.store.load();
      const selectedIds = [command.targetId, ...command.sourceIds];
      const selected = selectedIds.map((transactionId) =>
        state.transactions.find(
          (transaction) =>
            transaction.transactionId === transactionId &&
            transaction.householdId === command.actor.householdId &&
            transaction.lifecycleState === "active",
        ),
      );
      if (
        selected.some((transaction) => transaction === undefined) ||
        selected.some(
          (transaction) =>
            transaction !== undefined &&
            command.expectedVersions[transaction.transactionId] !==
              transaction.aggregateVersion,
        )
      ) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      const aggregates = selected as readonly MergeTransaction[];
      if (hasMergeAncestryCycle(aggregates, state.transactions)) {
        return { kind: "Conflict", code: "MERGE_ANCESTRY_CYCLE" };
      }
      const flattened = flattenMergeLeaves(aggregates);
      if (flattened.kind === "overlap") {
        return { kind: "Conflict", code: "MERGE_LEAF_OVERLAP" };
      }
      if (flattened.kind === "incomplete") {
        return {
          kind: "ContractFailure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }

      const target = aggregates[0];
      const mergedId = `merged:${command.operationKey}`;
      const merged: MergeTransaction = {
        ...target,
        transactionId: mergedId,
        lifecycleState: "active",
        amountInWon: flattened.leaves.reduce(
          (sum, leaf) => sum + leaf.amountInWon,
          0,
        ),
        aggregateVersion: 1,
        mergeSnapshot: flattened.leaves.map((leaf) => ({ ...leaf })),
        mergeParentIds: [...selectedIds],
      };
      const selectedIdSet = new Set(selectedIds);
      const nextTransactions = state.transactions.map((transaction) =>
        selectedIdSet.has(transaction.transactionId)
          ? {
              ...transaction,
              lifecycleState: "superseded" as const,
              aggregateVersion: transaction.aggregateVersion + 1,
            }
          : { ...transaction },
      );
      nextTransactions.push(merged);
      const result = {
        kind: "Merged" as const,
        transactionId: mergedId,
        leafIds: flattened.leaves.map((leaf) => leaf.transactionId),
      };
      const committed = await input.store.commit({
        operationKey: command.operationKey,
        snapshot: {
          transactions: nextTransactions,
          events: [
            ...state.events.map((event) => ({ ...event })),
            { eventName: "TransactionChanged.v1", transactionId: mergedId },
          ],
        },
        result,
      });
      return committed.kind === "success" ? result : committed;
    },
  };
}
