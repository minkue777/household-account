export interface RegisteredCardCommandActor {
  readonly principalUid: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly capability: "paymentConfiguration:manage";
}

export interface RegisteredCardCommandRecord {
  readonly cardId: string;
  readonly householdId: string;
  readonly ownerMemberId: string;
  readonly cardCompanyCode: string;
  readonly lastFour?: string;
  readonly order: number;
  readonly version: number;
  readonly lifecycle: "active" | "retired";
}

export interface HistoricalCardEvidence {
  readonly transactionId: string;
  readonly householdId: string;
  readonly cardCompanyLabel: string;
  readonly lastFour?: string;
}

export type RegisteredCardCommandResult =
  | {
      readonly kind: "Created" | "Updated" | "Retired";
      readonly card: RegisteredCardCommandRecord;
    }
  | {
      readonly kind: "Reordered";
      readonly orderedCardIds: readonly string[];
      readonly collectionVersion: number;
    }
  | { readonly kind: "NotFound" }
  | {
      readonly kind: "Forbidden";
      readonly code: "HOUSEHOLD_FORBIDDEN" | "OWNER_FORBIDDEN";
    }
  | {
      readonly kind: "Conflict";
      readonly code: "VERSION_MISMATCH" | "DUPLICATE_CARD";
    }
  | {
      readonly kind: "Rejected";
      readonly code:
        | "INVALID_LAST_FOUR"
        | "INCOMPLETE_CARD_SET"
        | "DUPLICATE_CARD_ID"
        | "FOREIGN_CARD_ID";
    }
  | {
      readonly kind: "RetryableFailure";
      readonly code: "ATOMIC_COMMIT_FAILED";
    };

export interface RegisteredCardCommandState {
  readonly cards: readonly RegisteredCardCommandRecord[];
  readonly claims: readonly {
    readonly householdId: string;
    readonly ownerMemberId: string;
    readonly cardCompanyCode: string;
    readonly lastFour?: string;
    readonly cardId: string;
  }[];
  readonly historicalEvidence: readonly HistoricalCardEvidence[];
  readonly collectionVersions: Readonly<Record<string, number>>;
}

export interface RegisteredCardCommandBoundaryInputPort {
  register(input: {
    readonly actor: RegisteredCardCommandActor;
    readonly ownerMemberId: string;
    readonly cardId: string;
    readonly cardCompanyCode: string;
    readonly rawLastFour?: string;
  }): RegisteredCardCommandResult;
  updateLastFour(input: {
    readonly actor: RegisteredCardCommandActor;
    readonly cardId: string;
    readonly rawLastFour?: string;
    readonly expectedVersion: number;
    readonly commitOutcome?: "success" | "failure";
  }): RegisteredCardCommandResult;
  retire(input: {
    readonly actor: RegisteredCardCommandActor;
    readonly cardId: string;
    readonly expectedVersion: number;
    readonly commitOutcome?: "success" | "failure";
  }): RegisteredCardCommandResult;
  reorder(input: {
    readonly actor: RegisteredCardCommandActor;
    readonly ownerMemberId: string;
    readonly orderedCardIds: readonly string[];
    readonly expectedCollectionVersion: number;
    readonly commitOutcome?: "success" | "failure";
  }): RegisteredCardCommandResult;
  searchHistorical(input: {
    readonly actor: RegisteredCardCommandActor;
    readonly query: string;
  }): readonly HistoricalCardEvidence[];
  availableCommands(): readonly string[];
  state(): RegisteredCardCommandState;
}
