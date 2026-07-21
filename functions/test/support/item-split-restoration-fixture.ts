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
  const receipts = new Map<string, ItemSplitResult>();
  const store: ItemSplitStore = {
    findReceipt: async (operationKey) => receipts.get(operationKey),
    load: async () => clone(snapshot),
    replaceAtomically: async ({ operationKey, snapshot: next, result }) => {
      snapshot = clone(next);
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
