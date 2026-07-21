export interface LegacyShortcutOwnerPolicyInput {
  readonly householdId: string;
  readonly requestedOwnerMemberId?: string;
  readonly currentFcmOwner?: {
    readonly householdId: string;
    readonly memberId: string;
  };
  readonly registeredCards: readonly {
    readonly householdId: string;
    readonly ownerMemberId: string;
    readonly company: string;
    readonly lastFour?: string;
  }[];
  readonly parsedCard: { readonly company: string; readonly lastFour?: string };
  readonly companyOwners: readonly {
    readonly householdId: string;
    readonly company: string;
    readonly memberId: string;
  }[];
}

export type LegacyShortcutOwnerPolicyResult =
  | {
      readonly kind: "Resolved";
      readonly memberId: string;
      readonly evidence:
        | "CURRENT_FCM_OWNER"
        | "FIRST_MATCHING_REGISTERED_CARD"
        | "UNIQUE_COMPANY_OWNER"
        | "REQUEST_OWNER_FALLBACK";
    }
  | { readonly kind: "Unresolved" };

const canonical = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");

const nonBlank = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0;

export function resolveLegacyShortcutOwner(
  input: LegacyShortcutOwnerPolicyInput,
): LegacyShortcutOwnerPolicyResult {
  if (
    input.currentFcmOwner?.householdId === input.householdId &&
    nonBlank(input.currentFcmOwner.memberId)
  ) {
    return {
      kind: "Resolved",
      memberId: input.currentFcmOwner.memberId,
      evidence: "CURRENT_FCM_OWNER",
    };
  }

  const parsedCompany = canonical(input.parsedCard.company);
  const matchingCard = input.registeredCards.find(
    (card) =>
      card.householdId === input.householdId &&
      nonBlank(card.ownerMemberId) &&
      canonical(card.company) === parsedCompany &&
      (input.parsedCard.lastFour === undefined ||
        card.lastFour === undefined ||
        card.lastFour === input.parsedCard.lastFour),
  );
  if (matchingCard !== undefined) {
    return {
      kind: "Resolved",
      memberId: matchingCard.ownerMemberId,
      evidence: "FIRST_MATCHING_REGISTERED_CARD",
    };
  }

  const companyOwnerIds = [
    ...new Set(
      input.companyOwners
        .filter(
          (owner) =>
            owner.householdId === input.householdId &&
            canonical(owner.company) === parsedCompany &&
            nonBlank(owner.memberId),
        )
        .map(({ memberId }) => memberId),
    ),
  ];
  if (companyOwnerIds.length === 1) {
    return {
      kind: "Resolved",
      memberId: companyOwnerIds[0],
      evidence: "UNIQUE_COMPANY_OWNER",
    };
  }

  if (nonBlank(input.requestedOwnerMemberId)) {
    return {
      kind: "Resolved",
      memberId: input.requestedOwnerMemberId,
      evidence: "REQUEST_OWNER_FALLBACK",
    };
  }

  return { kind: "Unresolved" };
}
