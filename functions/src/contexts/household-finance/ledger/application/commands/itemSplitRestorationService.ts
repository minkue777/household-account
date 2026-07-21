import type { ItemSplitStore } from "../ports/itemSplitStore";
import type {
  ItemSplitResult,
  ItemSplitTransaction,
} from "../../domain/model/itemSplitRestoration";

export interface ItemSplitRestorationCommands {
  split(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    sourceId: string;
    expectedVersion: number;
    baseDraft?: {
      merchant: string;
      amountInWon: number;
      categoryId: string;
      memo: string;
    };
    items: readonly {
      merchant: string;
      amountInWon: number;
      categoryId: string;
      memo: string;
    }[];
  }): Promise<ItemSplitResult>;
  restore(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    sourceId: string;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<ItemSplitResult>;
}

function validationError(
  code: Extract<ItemSplitResult, { kind: "ValidationError" }>['code'],
): Extract<ItemSplitResult, { kind: "ValidationError" }> {
  return { kind: "ValidationError", code };
}

export function createItemSplitRestorationCommands(input: {
  store: ItemSplitStore;
}): ItemSplitRestorationCommands {
  return {
    split: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const snapshot = await input.store.load();
      const source = snapshot.transactions.find(
        (transaction) =>
          transaction.transactionId === command.sourceId &&
          transaction.householdId === command.actor.householdId &&
          transaction.lifecycleState === "active",
      );
      if (
        source === undefined ||
        source.aggregateVersion !== command.expectedVersion
      ) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      const splitSource: ItemSplitTransaction =
        command.baseDraft === undefined
          ? source
          : {
              ...source,
              merchant: command.baseDraft.merchant,
              amountInWon: command.baseDraft.amountInWon,
              categoryId: command.baseDraft.categoryId,
              memo: command.baseDraft.memo,
            };
      if (command.items.length < 2) {
        return validationError("ITEM_SPLIT_REQUIRES_AT_LEAST_TWO_ITEMS");
      }
      if (
        command.items.some(
          (item) =>
            !Number.isSafeInteger(item.amountInWon) || item.amountInWon <= 0,
        )
      ) {
        return validationError("ITEM_AMOUNT_NOT_POSITIVE_INTEGER");
      }
      if (
        command.items.reduce((sum, item) => sum + item.amountInWon, 0) !==
        splitSource.amountInWon
      ) {
        return validationError("SPLIT_SUM_MISMATCH");
      }

      const superseded: ItemSplitTransaction = {
        ...splitSource,
        lifecycleState: "superseded",
        aggregateVersion: source.aggregateVersion + 1,
      };
      const derived = command.items.map<ItemSplitTransaction>((item, index) => ({
        transactionId: `${source.transactionId}:item:${index + 1}:${command.operationKey}`,
        householdId: splitSource.householdId,
        lifecycleState: "active",
        merchant: item.merchant,
        amountInWon: item.amountInWon,
        categoryId: item.categoryId,
        memo: item.memo,
        source: splitSource.source,
        originChannel: splitSource.originChannel,
        creatorMemberId: splitSource.creatorMemberId,
        cardEvidence: splitSource.cardEvidence,
        captureLineageId: splitSource.captureLineageId,
        aggregateVersion: 1,
        derivedFromTransactionId: source.transactionId,
      }));
      const nextTransactions = snapshot.transactions.map((transaction) =>
        transaction.transactionId === source.transactionId
          ? superseded
          : { ...transaction },
      );
      nextTransactions.push(...derived);
      const result = {
        kind: "Split" as const,
        sourceId: source.transactionId,
        derivedIds: derived.map((transaction) => transaction.transactionId),
      };
      const committed = await input.store.replaceAtomically({
        operationKey: command.operationKey,
        snapshot: {
          transactions: nextTransactions,
          dedupClaims: snapshot.dedupClaims.map((claim) => ({ ...claim })),
        },
        result,
      });
      return committed.kind === "success" ? result : committed;
    },

    restore: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const snapshot = await input.store.load();
      const source = snapshot.transactions.find(
        (transaction) =>
          transaction.transactionId === command.sourceId &&
          transaction.householdId === command.actor.householdId &&
          transaction.lifecycleState === "superseded",
      );
      const derived = snapshot.transactions.filter(
        (transaction) =>
          transaction.householdId === command.actor.householdId &&
          transaction.derivedFromTransactionId === command.sourceId,
      );
      if (
        source === undefined ||
        derived.length === 0 ||
        [source, ...derived].some(
          (transaction) =>
            command.expectedVersions[transaction.transactionId] !==
            transaction.aggregateVersion,
        )
      ) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }

      const derivedIds = new Set(
        derived.map((transaction) => transaction.transactionId),
      );
      const restored: ItemSplitTransaction = {
        ...source,
        lifecycleState: "active",
        aggregateVersion: source.aggregateVersion + 1,
      };
      const result = {
        kind: "Restored" as const,
        transactionId: restored.transactionId,
      };
      const committed = await input.store.replaceAtomically({
        operationKey: command.operationKey,
        snapshot: {
          transactions: snapshot.transactions
            .filter(
              (transaction) => !derivedIds.has(transaction.transactionId),
            )
            .map((transaction) =>
              transaction.transactionId === restored.transactionId
                ? restored
                : { ...transaction },
            ),
          dedupClaims: snapshot.dedupClaims.map((claim) => ({ ...claim })),
        },
        result,
      });
      return committed.kind === "success" ? result : committed;
    },
  };
}
