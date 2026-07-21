export interface ResolvePaymentCardInput {
  readonly sourceKind: "payment" | "city-gas";
  readonly actingMemberId: string;
  readonly parsedEvidence: {
    readonly companyLabel: string;
    readonly maskedToken?: string;
  };
}

export type PaymentCardResolutionResult =
  | { readonly kind: "Eligible"; readonly canonicalCardId?: string }
  | { readonly kind: "Bypassed"; readonly reason: "CITY_GAS" }
  | {
      readonly kind: "Unmatched";
      readonly code: "CARD_NOT_REGISTERED_FOR_ACTOR";
    }
  | {
      readonly kind: "RetryableFailure";
      readonly code: "CARD_REPOSITORY_UNAVAILABLE";
    };

export interface PaymentCardResolutionInputPort {
  resolve(input: ResolvePaymentCardInput): Promise<PaymentCardResolutionResult>;
}
