import {
  canonicalCardCompanyLabel,
  isNumberlessQuickPaymentCompany,
  maskedCardTokenMatches,
  normalizeCardCompanyKey,
  normalizeMaskedCardToken,
  normalizeRegisteredLastFour,
} from "../value-objects/cardIdentity";

interface RegisteredCardCandidate {
  cardId: string;
  ownerMemberId: string;
  cardCompany: string;
  lastFour: string;
  orderIndex?: number;
  lifecycleState: "active" | "retired";
}

interface ParsedCardEvidenceCandidate {
  companyLabel: string;
  maskedToken?: string;
}

type OwnCardPolicyResult =
  | {
      kind: "eligible";
      canonicalEvidence?: {
        cardId: string;
        companyLabel: string;
        lastFour: string;
      };
    }
  | {
      kind: "unmatched";
      reason: "CARD_NOT_REGISTERED_FOR_ACTOR";
    };

function isExplicitlyOrdered(
  card: RegisteredCardCandidate,
): card is RegisteredCardCandidate & { orderIndex: number } {
  return typeof card.orderIndex === "number" && Number.isFinite(card.orderIndex);
}

function isNumberlessQuickPayment(card: RegisteredCardCandidate): boolean {
  return isNumberlessQuickPaymentCompany(card.cardCompany);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "ko");
}

export function resolveOwnCard(input: {
  actingMemberId: string;
  evidence: ParsedCardEvidenceCandidate;
  cards: readonly RegisteredCardCandidate[];
}): OwnCardPolicyResult {
  const evidenceCompany = normalizeCardCompanyKey(input.evidence.companyLabel);
  const evidenceToken = normalizeMaskedCardToken(input.evidence.maskedToken);
  const ownedCandidates = input.cards.filter(
    (card) =>
      card.lifecycleState === "active" &&
      card.ownerMemberId === input.actingMemberId &&
      normalizeCardCompanyKey(card.cardCompany) === evidenceCompany,
  );

  const exactCandidates =
    evidenceToken === undefined
      ? []
      : ownedCandidates.filter((card) => {
          const lastFour = normalizeRegisteredLastFour(card.lastFour);
          return (
            lastFour !== undefined &&
            maskedCardTokenMatches(lastFour, evidenceToken)
          );
        });
  const topCandidates =
    exactCandidates.length > 0
      ? exactCandidates
      : ownedCandidates.filter((card) => card.lastFour.trim() === "");

  if (topCandidates.length === 0) {
    return {
      kind: "unmatched",
      reason: "CARD_NOT_REGISTERED_FOR_ACTOR",
    };
  }

  if (exactCandidates.length === 1) {
    const exact = exactCandidates[0];
    const lastFour = normalizeRegisteredLastFour(exact.lastFour);

    if (lastFour !== undefined) {
      return {
        kind: "eligible",
        canonicalEvidence: {
          cardId: exact.cardId,
          companyLabel: canonicalCardCompanyLabel(exact.cardCompany),
          lastFour,
        },
      };
    }
  }

  return { kind: "eligible" };
}

export function listActiveOwnCards<TCard extends RegisteredCardCandidate>(input: {
  actingMemberId: string;
  cards: readonly TCard[];
}): readonly TCard[] {
  return input.cards
    .filter(
      (card) =>
        card.lifecycleState === "active" &&
        card.ownerMemberId === input.actingMemberId,
    )
    .slice()
    .sort((left, right) => {
      const leftOrdered = isExplicitlyOrdered(left);
      const rightOrdered = isExplicitlyOrdered(right);

      if (leftOrdered !== rightOrdered) return leftOrdered ? -1 : 1;
      if (
        leftOrdered &&
        rightOrdered &&
        left.orderIndex !== right.orderIndex
      ) {
        return left.orderIndex - right.orderIndex;
      }

      const quickPaymentDifference =
        Number(isNumberlessQuickPayment(left)) -
        Number(isNumberlessQuickPayment(right));
      if (quickPaymentDifference !== 0) return quickPaymentDifference;

      const companyDifference = compareText(
        normalizeCardCompanyKey(left.cardCompany),
        normalizeCardCompanyKey(right.cardCompany),
      );
      if (companyDifference !== 0) return companyDifference;

      const lastFourDifference = compareText(
        normalizeRegisteredLastFour(left.lastFour) ?? left.lastFour.trim(),
        normalizeRegisteredLastFour(right.lastFour) ?? right.lastFour.trim(),
      );
      if (lastFourDifference !== 0) return lastFourDifference;

      return compareText(left.cardId, right.cardId);
    });
}
