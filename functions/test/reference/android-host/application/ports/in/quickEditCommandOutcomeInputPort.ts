export interface QuickEditTransactionView {
  readonly transactionId: string;
  readonly merchant: string;
  readonly amountInWon: number;
  readonly categoryId: string;
  readonly memo: string;
  readonly aggregateVersion: number;
}

export type QuickEditOperation =
  | {
      readonly kind: "Update";
      readonly form: Pick<
        QuickEditTransactionView,
        "merchant" | "amountInWon" | "categoryId" | "memo"
      >;
    }
  | {
      readonly kind: "Delete";
      readonly confirmedMerchant: string;
      readonly confirmedAmountInWon: number;
    }
  | {
      readonly kind: "Split";
      readonly items: readonly {
        readonly merchant: string;
        readonly amountInWon: number;
        readonly categoryId: string;
        readonly memo: string;
      }[];
    }
  | { readonly kind: "RequestHouseholdNotification" };

export interface AuthenticatedQuickEditActor {
  readonly principalRef: string;
  readonly householdId: string;
  readonly memberId: string;
}

export type QuickEditAuthSession =
  | {
      readonly kind: "Authenticated";
      readonly actor: AuthenticatedQuickEditActor;
    }
  | { readonly kind: "Unauthenticated" };

export type QuickEditCommandResult =
  | { readonly kind: "Succeeded"; readonly operation: QuickEditOperation["kind"] }
  | {
      readonly kind: "ValidationFailed";
      readonly code:
        | "INVALID_AMOUNT"
        | "DELETE_CONFIRMATION_MISMATCH"
        | "INVALID_SPLIT"
        | "REQUESTER_REQUIRED";
    }
  | { readonly kind: "Failed"; readonly code: "SERVER_UNAVAILABLE" }
  | { readonly kind: "Conflict"; readonly code: "VERSION_MISMATCH" };

export interface QuickEditCommandState {
  readonly transaction?: QuickEditTransactionView;
  readonly derivedTransactions: readonly QuickEditTransactionView[];
  readonly screen: "Open" | "Closed";
  readonly successToasts: readonly string[];
  readonly completionEvents: readonly QuickEditOperation["kind"][];
  readonly notificationReceipts: readonly {
    readonly requesterMemberId: string;
    readonly requestedAt: string;
  }[];
}

export interface QuickEditCommandOutcomeInputPort {
  execute(input: {
    readonly operation: QuickEditOperation;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  }): Promise<QuickEditCommandResult>;
  recreateActivity(): void;
  state(): QuickEditCommandState;
}
