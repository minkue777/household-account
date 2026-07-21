export interface PaymentCardRecord {
  readonly cardId: string;
  readonly ownerMemberId: string;
  readonly companyLabel: string;
  readonly lastFour?: string;
  readonly lifecycle: "active" | "retired";
}

export type PaymentCardLookupResult =
  | { readonly kind: "Available"; readonly cards: readonly PaymentCardRecord[] }
  | {
      readonly kind: "Unavailable";
      readonly code: "CARD_REPOSITORY_UNAVAILABLE";
    };

export interface PaymentCardLookupPort {
  findForMember(actingMemberId: string): Promise<PaymentCardLookupResult>;
}
