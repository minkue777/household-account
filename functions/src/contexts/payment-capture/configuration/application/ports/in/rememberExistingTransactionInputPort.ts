export interface EditableRememberTransaction {
  readonly transactionId: string;
  readonly householdId: string;
  readonly transactionType: "expense" | "income";
  readonly merchant: string;
  readonly categoryId: string;
  readonly version: number;
}

export interface RememberedExactRule {
  readonly ruleId: string;
  readonly householdId: string;
  readonly normalizedKeyword: string;
  readonly categoryId: string;
}

export type RememberExistingTransactionResult =
  | {
      readonly kind: "UpdatedAndRuleCreated" | "UpdatedAndExistingRuleReused";
      readonly transactionId: string;
      readonly transactionVersion: number;
      readonly ruleId: string;
    }
  | {
      readonly kind: "UpdatedWithoutRule";
      readonly transactionId: string;
      readonly transactionVersion: number;
    }
  | { readonly kind: "NotFound" }
  | { readonly kind: "Forbidden"; readonly code: "HOUSEHOLD_FORBIDDEN" }
  | {
      readonly kind: "Conflict";
      readonly code: "TRANSACTION_VERSION_MISMATCH";
    }
  | {
      readonly kind: "Rejected";
      readonly code: "REMEMBER_NOT_AVAILABLE_FOR_INCOME";
    }
  | {
      readonly kind: "RetryableFailure";
      readonly code: "ATOMIC_COMMIT_FAILED";
    };

export interface RememberExistingTransactionState {
  readonly transactions: readonly EditableRememberTransaction[];
  readonly rules: readonly RememberedExactRule[];
  readonly exactClaims: readonly {
    readonly normalizedKeyword: string;
    readonly ruleId: string;
  }[];
}

export interface RememberExistingTransactionInputPort {
  update(input: {
    readonly actor: { readonly householdId: string; readonly memberId: string };
    readonly transactionId: string;
    readonly expectedVersion: number;
    readonly categoryId: string;
    readonly rememberForNextTime: boolean;
    readonly commitOutcome?: "success" | "failure";
  }): RememberExistingTransactionResult;
  state(): RememberExistingTransactionState;
}
