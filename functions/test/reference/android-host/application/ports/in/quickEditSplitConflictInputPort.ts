export interface QuickEditConflictFormSnapshot {
  readonly transactionId: string;
  readonly merchant: string;
  readonly amountInWon: number;
  readonly categoryId: string;
  readonly memo: string;
  readonly expectedVersion: number;
}

export interface QuickEditConflictSplitItem {
  readonly amountInWon: number;
  readonly merchant: string;
  readonly categoryId: string;
  readonly memo: string;
}

export interface QuickEditServerManagedEvidence {
  readonly cardId: string;
  readonly originChannel: "android-notification";
  readonly creatorMemberId: string;
  readonly captureLineageId: string;
}

export interface QuickEditLedgerTransactionSnapshot {
  readonly transactionId: string;
  readonly lifecycle: "active" | "superseded" | "deleted";
  readonly version: number;
  readonly merchant: string;
  readonly amountInWon: number;
  readonly categoryId: string;
  readonly memo: string;
  readonly evidence: QuickEditServerManagedEvidence;
}

export type QuickEditConflictSplitOutcome =
  | {
      readonly kind: "Success";
      readonly derivedTransactions: readonly QuickEditLedgerTransactionSnapshot[];
    }
  | {
      readonly kind: "Conflict";
      readonly code: "VERSION_MISMATCH";
      readonly targetLifecycle: "active" | "superseded" | "deleted";
      readonly mayRecreateDraftAfterConfirmation: boolean;
    };

export type QuickEditSplitReconfirmationOutcome =
  | { readonly kind: "DraftRecreated"; readonly expectedVersion: number }
  | { readonly kind: "Rejected"; readonly code: "TARGET_NOT_ACTIVE" };

export interface QuickEditSplitConflictState {
  readonly form: QuickEditConflictFormSnapshot;
  readonly draft?: {
    readonly baseForm: QuickEditConflictFormSnapshot;
    readonly items: readonly QuickEditConflictSplitItem[];
  };
  readonly ledgerTransactions: readonly QuickEditLedgerTransactionSnapshot[];
}

export interface QuickEditSplitConflictInputPort {
  editForm(
    patch: Partial<
      Pick<
        QuickEditConflictFormSnapshot,
        "merchant" | "amountInWon" | "categoryId" | "memo"
      >
    >,
  ): void;
  beginSplit(items: readonly QuickEditConflictSplitItem[]): void;
  applyConcurrentServerChange(change: {
    readonly lifecycle?: "active" | "superseded" | "deleted";
    readonly merchant?: string;
    readonly version: number;
  }): void;
  submitSplit(): Promise<QuickEditConflictSplitOutcome>;
  confirmLatestActiveAndRecreateDraft(): QuickEditSplitReconfirmationOutcome;
  state(): QuickEditSplitConflictState;
}
