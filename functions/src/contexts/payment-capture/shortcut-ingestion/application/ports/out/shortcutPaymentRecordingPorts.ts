import type {
  ShortcutParsedPayment,
  ShortcutPaymentActor,
  ShortcutTransactionDraft,
  ShortcutTransactionRecordedEventDraft,
} from "../../../domain/model/shortcutPaymentRecording";

export type ShortcutDefaultCategoryResult =
  | { readonly kind: "Found"; readonly categoryId: string }
  | { readonly kind: "Missing" }
  | { readonly kind: "Unavailable" };

export interface ShortcutDefaultCategoryPort {
  findForHousehold(
    householdId: string,
  ): Promise<ShortcutDefaultCategoryResult>;
}

export type ShortcutOwnedCardResolutionResult =
  | { readonly kind: "Eligible"; readonly canonicalCardId?: string }
  | {
      readonly kind: "Unmatched";
      readonly code: "CARD_NOT_REGISTERED_FOR_ACTOR";
    }
  | { readonly kind: "Unavailable" };

export interface ShortcutOwnedCardResolutionPort {
  resolve(input: {
    readonly actor: ShortcutPaymentActor;
    readonly evidence: ShortcutParsedPayment["cardEvidence"];
  }): Promise<ShortcutOwnedCardResolutionResult>;
}

export type ShortcutPaymentCommitResult =
  | { readonly kind: "Created"; readonly transactionId: string }
  | { readonly kind: "Unavailable" };

export interface ShortcutPaymentCommitPort {
  commit(input: {
    readonly commandId: string;
    readonly transaction: ShortcutTransactionDraft;
    readonly outboxEvent: ShortcutTransactionRecordedEventDraft;
  }): Promise<ShortcutPaymentCommitResult>;
}
