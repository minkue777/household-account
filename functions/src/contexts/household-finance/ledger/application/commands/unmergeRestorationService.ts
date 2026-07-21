import type { UnmergeRestorationStore } from "../ports/unmergeRestorationStore";
import type {
  UnmergeRestorationResult,
  UnmergeTransaction,
} from "../../domain/model/unmergeRestoration";

export interface UnmergeRestorationCommands {
  unmerge(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    mergedTransactionId: string;
    expectedVersion: number;
  }): Promise<UnmergeRestorationResult>;
}

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

export function createUnmergeRestorationCommands(input: {
  store: UnmergeRestorationStore;
}): UnmergeRestorationCommands {
  return {
    unmerge: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const transactions = await input.store.load();
      const merged = transactions.find(
        (transaction) =>
          transaction.transactionId === command.mergedTransactionId &&
          transaction.householdId === command.actor.householdId &&
          transaction.lifecycleState === "active",
      );
      if (
        merged === undefined ||
        merged.aggregateVersion !== command.expectedVersion
      ) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      const snapshots = merged.mergeLeafSnapshots;
      if (
        snapshots === undefined ||
        snapshots.length === 0 ||
        snapshots.some(
          (snapshot) =>
            snapshot.transactionId === undefined ||
            snapshot.captureLineageId === undefined,
        )
      ) {
        return {
          kind: "ContractFailure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }
      const leafIds = snapshots.map((snapshot) => snapshot.transactionId as string);
      const storedLeaves = leafIds.map((transactionId) =>
        transactions.find(
          (transaction) =>
            transaction.transactionId === transactionId &&
            transaction.householdId === command.actor.householdId,
        ),
      );
      if (storedLeaves.some((transaction) => transaction === undefined)) {
        return {
          kind: "ContractFailure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }

      const snapshotById = new Map(
        snapshots.map((snapshot) => [snapshot.transactionId as string, snapshot]),
      );
      const next = transactions.map((transaction): UnmergeTransaction => {
        if (transaction.transactionId === merged.transactionId) {
          return {
            ...copy(transaction),
            lifecycleState: "superseded",
            aggregateVersion: transaction.aggregateVersion + 1,
          };
        }
        const leaf = snapshotById.get(transaction.transactionId);
        if (leaf === undefined) return copy(transaction);
        return {
          ...copy(transaction),
          lifecycleState: "active",
          merchant: leaf.merchant,
          amountInWon: leaf.amountInWon,
          categoryId: leaf.categoryId,
          memo: leaf.memo,
          accountingDate: merged.accountingDate,
          localTime: merged.localTime,
          transactionType: merged.transactionType,
          cardDisplay: merged.cardDisplay,
          source: leaf.source,
          originChannel: leaf.originChannel,
          creatorMemberId: leaf.creatorMemberId,
          captureLineageId: leaf.captureLineageId,
          captureCardEvidence: leaf.captureCardEvidence,
          aggregateVersion: transaction.aggregateVersion + 1,
        };
      });
      const result = {
        kind: "Unmerged" as const,
        restoredTransactionIds: leafIds,
      };
      const committed = await input.store.commit({
        operationKey: command.operationKey,
        expectedVersion: command.expectedVersion,
        mergedTransactionId: command.mergedTransactionId,
        transactions: next,
        result,
      });
      return committed.kind === "success" ? result : committed;
    },
  };
}
