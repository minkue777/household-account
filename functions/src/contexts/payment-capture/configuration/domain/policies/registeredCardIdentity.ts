import type { RegisteredCard } from "../model/registeredCardRegistry";
import {
  canonicalCardCompanyLabel,
  normalizeCardCompanyKey,
  normalizeRegisteredLastFour,
} from "../value-objects/cardIdentity";

export type NormalizedCardIdentityResult =
  | {
      readonly kind: "valid";
      readonly cardCompany: string;
      readonly lastFour: string;
    }
  | {
      readonly kind: "rejected";
      readonly code: "INVALID_CARD_COMPANY" | "INVALID_LAST_FOUR";
    };

export function normalizeCardIdentity(input: {
  readonly cardCompany: string;
  readonly rawCardNumber?: string;
}): NormalizedCardIdentityResult {
  const cardCompany = canonicalCardCompanyLabel(input.cardCompany);
  if (normalizeCardCompanyKey(cardCompany) === "") {
    return { kind: "rejected", code: "INVALID_CARD_COMPANY" };
  }

  if (
    input.rawCardNumber === undefined ||
    input.rawCardNumber.trim() === ""
  ) {
    return { kind: "valid", cardCompany, lastFour: "" };
  }

  const lastFour = normalizeRegisteredLastFour(input.rawCardNumber);
  return lastFour === undefined
    ? { kind: "rejected", code: "INVALID_LAST_FOUR" }
    : { kind: "valid", cardCompany, lastFour };
}

export function registeredCardClaimKey(input: {
  readonly householdId: string;
  readonly ownerMemberId: string;
  readonly cardCompany: string;
  readonly lastFour: string;
}): string {
  return JSON.stringify([
    input.householdId,
    input.ownerMemberId,
    normalizeCardCompanyKey(input.cardCompany),
    input.lastFour,
  ]);
}

export type RegisteredCardIdentityUpdateDecision =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "rejected";
      readonly code:
        | "CARD_IDENTITY_CHANGE_REQUIRES_REREGISTRATION"
        | "CUSTOM_CARD_ALIAS_NOT_SUPPORTED";
    };

export function decideRegisteredCardIdentityUpdate(input: {
  readonly current: RegisteredCard;
  readonly requestedOwnerMemberId?: string;
  readonly requestedCardCompany?: string;
  readonly customAlias?: string;
}): RegisteredCardIdentityUpdateDecision {
  if (
    (input.requestedOwnerMemberId !== undefined &&
      input.requestedOwnerMemberId !== input.current.ownerMemberId) ||
    (input.requestedCardCompany !== undefined &&
      normalizeCardCompanyKey(input.requestedCardCompany) !==
        normalizeCardCompanyKey(input.current.cardCompany))
  ) {
    return {
      kind: "rejected",
      code: "CARD_IDENTITY_CHANGE_REQUIRES_REREGISTRATION",
    };
  }

  if (input.customAlias !== undefined) {
    return { kind: "rejected", code: "CUSTOM_CARD_ALIAS_NOT_SUPPORTED" };
  }

  return { kind: "allowed" };
}
