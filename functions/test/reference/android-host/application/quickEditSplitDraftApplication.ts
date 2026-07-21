import type {
  QuickEditSplitDraftInputPort,
  QuickEditSplitDraftState,
} from "./ports/in/quickEditSplitDraftInputPort";
import type { QuickEditSplitDraftIdentityPort } from "./ports/out/quickEditSplitDraftIdentityPort";

function snapshot(state: QuickEditSplitDraftState): QuickEditSplitDraftState {
  return { ...state, items: state.items.map((item) => ({ ...item })) };
}

function unallocated(original: number, items: QuickEditSplitDraftState["items"]): number {
  return Math.max(0, original - items.reduce((sum, item) => sum + item.amountInWon, 0));
}

export function createQuickEditSplitDraftApplication(dependencies: {
  readonly identities: QuickEditSplitDraftIdentityPort;
}): QuickEditSplitDraftInputPort {
  let draft: QuickEditSplitDraftState = {
    originalAmountInWon: 0,
    items: [],
    unallocatedAmountInWon: 0,
  };

  return {
    initialize(originalAmountInWon) {
      const first = Math.floor(originalAmountInWon / 2);
      draft = {
        originalAmountInWon,
        items: [
          { itemId: dependencies.identities.nextItemId(), amountInWon: first },
          {
            itemId: dependencies.identities.nextItemId(),
            amountInWon: originalAmountInWon - first,
          },
        ],
        unallocatedAmountInWon: 0,
      };
      return snapshot(draft);
    },
    changeAmount(itemId, amountInWon) {
      const index = draft.items.findIndex((item) => item.itemId === itemId);
      if (index < 0) return { kind: "Rejected", code: "ITEM_NOT_FOUND" };
      const items = draft.items.map((item) => ({ ...item }));
      items[index] = { ...items[index], amountInWon };
      if (items.length === 2) {
        const other = index === 0 ? 1 : 0;
        items[other] = {
          ...items[other],
          amountInWon: Math.max(0, draft.originalAmountInWon - amountInWon),
        };
      }
      draft = {
        ...draft,
        items,
        unallocatedAmountInWon: unallocated(draft.originalAmountInWon, items),
      };
      return { kind: "Updated", draft: snapshot(draft) };
    },
    addItem() {
      const items = [
        ...draft.items.map((item) => ({ ...item })),
        {
          itemId: dependencies.identities.nextItemId(),
          amountInWon: draft.unallocatedAmountInWon,
        },
      ];
      draft = {
        ...draft,
        items,
        unallocatedAmountInWon: unallocated(draft.originalAmountInWon, items),
      };
      return { kind: "Updated", draft: snapshot(draft) };
    },
    removeItem(itemId) {
      if (!draft.items.some((item) => item.itemId === itemId)) {
        return { kind: "Rejected", code: "ITEM_NOT_FOUND" };
      }
      if (draft.items.length <= 2) {
        return { kind: "Rejected", code: "MINIMUM_TWO_ITEMS" };
      }
      const items = draft.items.filter((item) => item.itemId !== itemId);
      draft = {
        ...draft,
        items,
        unallocatedAmountInWon: unallocated(draft.originalAmountInWon, items),
      };
      return { kind: "Updated", draft: snapshot(draft) };
    },
    validate() {
      if (draft.items.length < 2) return { kind: "Invalid", code: "MINIMUM_TWO_ITEMS" };
      if (draft.items.some(({ amountInWon }) => amountInWon <= 0)) {
        return { kind: "Invalid", code: "NON_POSITIVE_ITEM" };
      }
      const total = draft.items.reduce((sum, item) => sum + item.amountInWon, 0);
      return total === draft.originalAmountInWon
        ? { kind: "Valid" }
        : { kind: "Invalid", code: "TOTAL_MISMATCH" };
    },
    state: () => snapshot(draft),
  };
}
