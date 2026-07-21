export interface ShortcutPaymentActor {
  readonly householdId: string;
  readonly memberId: string;
}

export interface ShortcutParsedPayment {
  readonly amountInWon: number;
  readonly merchant: string;
  readonly cardEvidence: {
    readonly companyLabel: string;
    readonly maskedToken?: string;
  };
}

export interface ShortcutPaymentRecordingCommand {
  readonly commandId: string;
  readonly actor: ShortcutPaymentActor;
  readonly parsed: ShortcutParsedPayment;
}

export interface ShortcutTransactionDraft {
  readonly householdId: string;
  readonly creatorMemberId: string;
  readonly transactionType: "expense";
  readonly categoryId: string;
  readonly memo: "";
  readonly source: "ios-shortcut";
  readonly amountInWon: number;
  readonly merchant: string;
  readonly cardEvidence: ShortcutParsedPayment["cardEvidence"];
  readonly selectedRegisteredCardId?: string;
}

export interface ShortcutTransactionRecordedEventDraft {
  readonly eventId: string;
  readonly eventName: "TransactionRecorded.v1";
  readonly recipient: {
    readonly kind: "creator-member";
    readonly memberId: string;
  };
  readonly endpointCapability: "ios-pwa-push";
}

export type ShortcutPaymentRecordingResult =
  | { readonly kind: "Created"; readonly transactionId: string }
  | {
      readonly kind: "Rejected";
      readonly code:
        | "CARD_NOT_REGISTERED_FOR_ACTOR"
        | "DEFAULT_CATEGORY_UNAVAILABLE";
    }
  | {
      readonly kind: "RetryableFailure";
      readonly code:
        | "REFERENCE_DATA_UNAVAILABLE"
        | "TRANSACTION_COMMIT_UNAVAILABLE";
    };

export interface LegacyShortcutCardTypeCharacterization {
  readonly kind: "LegacyOnly";
  readonly cardType: "legacy-samsung-1876" | null;
}
