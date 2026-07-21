export interface RegisteredCardActor {
  readonly householdId: string;
  readonly memberId: string;
}

export interface RegisteredCardView {
  readonly cardId: string;
  readonly householdId: string;
  readonly ownerMemberId: string;
  readonly cardCompany: string;
  readonly lastFour: string;
  readonly orderIndex?: number;
  readonly lifecycleState: "active" | "retired";
  readonly version: number;
}

export interface RegisterCardCommand {
  readonly commandId: string;
  readonly actor: RegisteredCardActor;
  readonly householdId: string;
  readonly ownerMemberId: string;
  readonly cardCompany: string;
  readonly cardNumber?: string;
}

export interface UpdateRegisteredCardCommand {
  readonly actor: RegisteredCardActor;
  readonly cardId: string;
  readonly expectedVersion: number;
  readonly lastFour?: string;
  readonly requestedOwnerMemberId?: string;
  readonly requestedCardCompany?: string;
  readonly customAlias?: string;
}

export interface RetireRegisteredCardCommand {
  readonly actor: RegisteredCardActor;
  readonly cardId: string;
  readonly expectedVersion: number;
}

export type CardBoundaryFailure =
  | { readonly kind: "Forbidden"; readonly code: "HOUSEHOLD_FORBIDDEN" }
  | { readonly kind: "Forbidden"; readonly code: "OWNER_FORBIDDEN" };

export type RegisterCardResult =
  | { readonly kind: "Registered"; readonly card: RegisteredCardView }
  | { readonly kind: "Duplicate"; readonly existingCardId: string }
  | CardBoundaryFailure
  | {
      readonly kind: "Rejected";
      readonly code: "INVALID_CARD_COMPANY" | "INVALID_LAST_FOUR";
    };

export type UpdateCardResult =
  | { readonly kind: "Updated"; readonly card: RegisteredCardView }
  | { readonly kind: "Duplicate"; readonly existingCardId: string }
  | { readonly kind: "Conflict"; readonly code: "VERSION_MISMATCH" }
  | { readonly kind: "NotFound" }
  | CardBoundaryFailure
  | {
      readonly kind: "Rejected";
      readonly code:
        | "CARD_IDENTITY_CHANGE_REQUIRES_REREGISTRATION"
        | "CUSTOM_CARD_ALIAS_NOT_SUPPORTED"
        | "INVALID_LAST_FOUR"
        | "CARD_RETIRED";
    };

export type RetireCardResult =
  | { readonly kind: "Retired"; readonly card: RegisteredCardView }
  | { readonly kind: "Conflict"; readonly code: "VERSION_MISMATCH" }
  | { readonly kind: "NotFound" }
  | CardBoundaryFailure;

export type ResolveRegisteredCardResult =
  | {
      readonly kind: "Eligible";
      readonly canonicalEvidence?: {
        readonly cardId: string;
        readonly companyLabel: string;
        readonly lastFour: string;
      };
    }
  | { readonly kind: "Unmatched" };

export interface RegisteredCardManagementInputPort {
  register(input: RegisterCardCommand): Promise<RegisterCardResult>;
  update(input: UpdateRegisteredCardCommand): Promise<UpdateCardResult>;
  retire(input: RetireRegisteredCardCommand): Promise<RetireCardResult>;
  listActive(actor: RegisteredCardActor): readonly RegisteredCardView[];
  resolve(input: {
    readonly actor: RegisteredCardActor;
    readonly cardCompany: string;
    readonly cardToken?: string;
  }): ResolveRegisteredCardResult;
}
