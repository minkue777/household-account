export interface RecurringCategoryPlanState {
  readonly planId: string;
  readonly categoryId: string;
  readonly active: boolean;
  readonly lifecycleState: "active" | "deleted";
  readonly version: number;
}

export interface HistoricalLedgerCategoryState {
  readonly transactionId: string;
  readonly recurringPlanId: string;
  readonly categoryId: string;
}

export interface CategoryRemapPage {
  readonly processId: string;
  readonly fromCategoryId: string;
  readonly toDefaultCategoryId: string;
  readonly changedCount: number;
  readonly nextCursor: string | null;
  readonly completed: boolean;
}

export type CategoryRemapResult =
  | { readonly kind: "success"; readonly page: CategoryRemapPage }
  | { readonly kind: "already-processed"; readonly page: CategoryRemapPage }
  | { readonly kind: "validation-error"; readonly code: string }
  | { readonly kind: "conflict"; readonly code: string }
  | {
      readonly kind: "retryable-failure";
      readonly code: string;
      readonly retryCursor?: string;
    };

export interface RecurringCategoryRemapReceipt {
  readonly receiptKey: string;
  readonly payloadHash: string;
  readonly changedPlanIds: readonly string[];
  readonly page: CategoryRemapPage;
}

export interface RecurringCategoryRemapEvent {
  readonly eventType: "RecurringPlanChanged.v1";
  readonly planId: string;
  readonly changeKind: "category-remapped";
  readonly planVersion: number;
}

export interface RecurringCategoryRemapState {
  readonly plans: readonly RecurringCategoryPlanState[];
  readonly historicalLedgerTransactions: readonly HistoricalLedgerCategoryState[];
  readonly receipts: readonly RecurringCategoryRemapReceipt[];
  readonly events: readonly RecurringCategoryRemapEvent[];
}

export type RecurringCategoryRemapDecision =
  | { readonly kind: "return"; readonly result: CategoryRemapResult }
  | {
      readonly kind: "commit";
      readonly nextState: RecurringCategoryRemapState;
      readonly result: CategoryRemapResult;
      readonly selectedPlanIds: readonly string[];
    };
