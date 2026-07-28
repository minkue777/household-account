import { createItemSplitRestorationCommands } from "../../src/contexts/household-finance/ledger/application/commands/itemSplitRestorationService";
import type { ItemSplitStore } from "../../src/contexts/household-finance/ledger/application/ports/itemSplitStore";
import type {
  ItemSplitResult,
  ItemSplitSnapshot,
} from "../../src/contexts/household-finance/ledger/domain/model/itemSplitRestoration";

function clone(snapshot: ItemSplitSnapshot): ItemSplitSnapshot {
  return {
    transactions: snapshot.transactions.map((transaction) => ({ ...transaction })),
    dedupClaims: snapshot.dedupClaims.map((claim) => ({ ...claim })),
  };
}

export function createItemSplitRestorationFixtureSubject(
  fixture: ItemSplitSnapshot,
) {
  let snapshot = clone(fixture);
  let loadedIds = new Set<string>();
  const receipts = new Map<string, ItemSplitResult>();
  const store: ItemSplitStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    load: async ({ sourceId, includeDerived }) => {
      const selected = snapshot.transactions.filter(
        ({ transactionId, derivedFromTransactionId }) =>
          transactionId === sourceId ||
          (includeDerived && derivedFromTransactionId === sourceId),
      );
      loadedIds = new Set(selected.map(({ transactionId }) => transactionId));
      return {
        transactions: selected.map((transaction) => ({ ...transaction })),
        dedupClaims: snapshot.dedupClaims.map((claim) => ({ ...claim })),
      };
    },
    replaceAtomically: async ({ operationKey, snapshot: next, result }) => {
      const nextIds = new Set(
        next.transactions.map(({ transactionId }) => transactionId),
      );
      snapshot = {
        transactions: [
          ...snapshot.transactions.filter(
            ({ transactionId }) =>
              !loadedIds.has(transactionId) && !nextIds.has(transactionId),
          ),
          ...next.transactions.map((transaction) => ({ ...transaction })),
        ],
        dedupClaims: next.dedupClaims.map((claim) => ({ ...claim })),
      };
      receipts.set(operationKey, result);
      return { kind: "success" };
    },
  };
  const commands = createItemSplitRestorationCommands({ store });
  return {
    ...commands,
    snapshot: () => clone(snapshot),
  };
}
