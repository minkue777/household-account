export interface QuickEditSplitItem {
  readonly itemId: string;
  readonly amountInWon: number;
}

export interface QuickEditSplitDraftState {
  readonly originalAmountInWon: number;
  readonly items: readonly QuickEditSplitItem[];
  readonly unallocatedAmountInWon: number;
}

export type SplitDraftMutationResult =
  | { readonly kind: "Updated"; readonly draft: QuickEditSplitDraftState }
  | { readonly kind: "Rejected"; readonly code: "MINIMUM_TWO_ITEMS" | "ITEM_NOT_FOUND" };

export type SplitDraftValidationResult =
  | { readonly kind: "Valid" }
  | {
      readonly kind: "Invalid";
      readonly code: "MINIMUM_TWO_ITEMS" | "NON_POSITIVE_ITEM" | "TOTAL_MISMATCH";
    };

export interface QuickEditSplitDraftInputPort {
  initialize(originalAmountInWon: number): QuickEditSplitDraftState;
  changeAmount(itemId: string, amountInWon: number): SplitDraftMutationResult;
  addItem(): SplitDraftMutationResult;
  removeItem(itemId: string): SplitDraftMutationResult;
  validate(): SplitDraftValidationResult;
  state(): QuickEditSplitDraftState;
}
