export type RegisteredCardLifecycleState = "active" | "retired";

export interface RegisteredCard {
  readonly cardId: string;
  readonly householdId: string;
  readonly ownerMemberId: string;
  readonly cardCompany: string;
  readonly lastFour: string;
  readonly orderIndex?: number;
  readonly lifecycleState: RegisteredCardLifecycleState;
  readonly version: number;
}

export interface RegisteredCardClaim {
  readonly claimKey: string;
  readonly householdId: string;
  readonly ownerMemberId: string;
  readonly cardCompany: string;
  readonly lastFour: string;
  readonly cardId: string;
}

export interface RegisteredCardRegistry {
  readonly cards: readonly RegisteredCard[];
  readonly activeClaims: readonly RegisteredCardClaim[];
}
