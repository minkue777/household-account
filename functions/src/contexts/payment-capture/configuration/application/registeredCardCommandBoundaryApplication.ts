import { normalizeCardCompanyKey } from "../domain/value-objects/cardIdentity";
import { normalizeMerchantText } from "../domain/value-objects/merchantKeyword";
import type {
  HistoricalCardEvidence,
  RegisteredCardCommandActor,
  RegisteredCardCommandBoundaryInputPort,
  RegisteredCardCommandRecord,
  RegisteredCardCommandState,
} from "./ports/in/registeredCardCommandBoundaryInputPort";

interface CardClaim {
  householdId: string;
  ownerMemberId: string;
  cardCompanyCode: string;
  lastFour?: string;
  cardId: string;
}

const cloneCard = (
  card: RegisteredCardCommandRecord,
): RegisteredCardCommandRecord => ({ ...card });

const claimFor = (card: RegisteredCardCommandRecord): CardClaim => ({
  householdId: card.householdId,
  ownerMemberId: card.ownerMemberId,
  cardCompanyCode: card.cardCompanyCode,
  ...(card.lastFour === undefined ? {} : { lastFour: card.lastFour }),
  cardId: card.cardId,
});

const sameClaim = (left: CardClaim, right: CardClaim): boolean =>
  left.householdId === right.householdId &&
  left.ownerMemberId === right.ownerMemberId &&
  normalizeCardCompanyKey(left.cardCompanyCode) ===
    normalizeCardCompanyKey(right.cardCompanyCode) &&
  left.lastFour === right.lastFour;

function normalizeBoundaryLastFour(
  raw: string | undefined,
): { kind: "Valid"; lastFour?: string } | { kind: "Invalid" } {
  if (raw === undefined || raw.trim() === "") return { kind: "Valid" };
  const trimmed = raw.trim();
  if (/^\d{4}$/.test(trimmed)) {
    return { kind: "Valid", lastFour: trimmed };
  }
  if (!/^[\d\s-]+$/.test(trimmed)) return { kind: "Invalid" };
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 12 && digits.length <= 19
    ? { kind: "Valid", lastFour: digits.slice(-4) }
    : { kind: "Invalid" };
}

export function createRegisteredCardCommandBoundaryApplication(options: {
  readonly boundaryHouseholdId: string;
  readonly cards?: readonly RegisteredCardCommandRecord[];
  readonly historicalEvidence?: readonly HistoricalCardEvidence[];
  readonly collectionVersions?: Readonly<Record<string, number>>;
}): RegisteredCardCommandBoundaryInputPort {
  let cards = (options.cards ?? []).map(cloneCard);
  let claims = cards.filter(({ lifecycle }) => lifecycle === "active").map(claimFor);
  const historicalEvidence = (options.historicalEvidence ?? []).map((item) => ({
    ...item,
  }));
  let collectionVersions: Record<string, number> = {
    ...(options.collectionVersions ?? {}),
  };

  const collectionKey = (householdId: string, ownerMemberId: string): string =>
    `${householdId}:${ownerMemberId}`;

  const authorizeHousehold = (
    actor: RegisteredCardCommandActor,
  ): { kind: "Forbidden"; code: "HOUSEHOLD_FORBIDDEN" } | undefined =>
    actor.householdId !== options.boundaryHouseholdId
      ? { kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" }
      : undefined;

  const authorizeCard = (
    actor: RegisteredCardCommandActor,
    card: RegisteredCardCommandRecord,
  ) => {
    if (
      actor.householdId !== options.boundaryHouseholdId ||
      card.householdId !== actor.householdId
    ) {
      return { kind: "Forbidden" as const, code: "HOUSEHOLD_FORBIDDEN" as const };
    }
    if (card.ownerMemberId !== actor.memberId) {
      return { kind: "Forbidden" as const, code: "OWNER_FORBIDDEN" as const };
    }
    return undefined;
  };

  return {
    register(input) {
      const householdForbidden = authorizeHousehold(input.actor);
      if (householdForbidden !== undefined) return householdForbidden;
      if (input.ownerMemberId !== input.actor.memberId) {
        return { kind: "Forbidden", code: "OWNER_FORBIDDEN" };
      }

      const normalized = normalizeBoundaryLastFour(input.rawLastFour);
      if (normalized.kind === "Invalid") {
        return { kind: "Rejected", code: "INVALID_LAST_FOUR" };
      }
      if (cards.some(({ cardId }) => cardId === input.cardId)) {
        return { kind: "Conflict", code: "DUPLICATE_CARD" };
      }

      const order = cards
        .filter(
          (card) =>
            card.householdId === input.actor.householdId &&
            card.ownerMemberId === input.ownerMemberId &&
            card.lifecycle === "active",
        )
        .reduce((maximum, card) => Math.max(maximum, card.order), -1) + 1;
      const created: RegisteredCardCommandRecord = {
        cardId: input.cardId,
        householdId: input.actor.householdId,
        ownerMemberId: input.ownerMemberId,
        cardCompanyCode: input.cardCompanyCode,
        ...(normalized.lastFour === undefined
          ? {}
          : { lastFour: normalized.lastFour }),
        order,
        version: 1,
        lifecycle: "active",
      };
      const newClaim = claimFor(created);
      if (claims.some((claim) => sameClaim(claim, newClaim))) {
        return { kind: "Conflict", code: "DUPLICATE_CARD" };
      }

      cards = [...cards, created];
      claims = [...claims, newClaim];
      return { kind: "Created", card: cloneCard(created) };
    },

    updateLastFour(input) {
      const index = cards.findIndex(({ cardId }) => cardId === input.cardId);
      if (index < 0) return { kind: "NotFound" };
      const current = cards[index];
      const forbidden = authorizeCard(input.actor, current);
      if (forbidden !== undefined) return forbidden;
      if (current.version !== input.expectedVersion) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      const normalized = normalizeBoundaryLastFour(input.rawLastFour);
      if (normalized.kind === "Invalid") {
        return { kind: "Rejected", code: "INVALID_LAST_FOUR" };
      }
      const updated: RegisteredCardCommandRecord = {
        ...current,
        ...(normalized.lastFour === undefined
          ? { lastFour: undefined }
          : { lastFour: normalized.lastFour }),
        version: current.version + 1,
      };
      const newClaim = claimFor(updated);
      if (
        claims.some(
          (claim) => claim.cardId !== current.cardId && sameClaim(claim, newClaim),
        )
      ) {
        return { kind: "Conflict", code: "DUPLICATE_CARD" };
      }
      if (input.commitOutcome === "failure") {
        return { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" };
      }

      cards = cards.map((card, cardIndex) =>
        cardIndex === index ? updated : card,
      );
      claims = [...claims.filter(({ cardId }) => cardId !== current.cardId), newClaim];
      return { kind: "Updated", card: cloneCard(updated) };
    },

    retire(input) {
      const index = cards.findIndex(({ cardId }) => cardId === input.cardId);
      if (index < 0) return { kind: "NotFound" };
      const current = cards[index];
      const forbidden = authorizeCard(input.actor, current);
      if (forbidden !== undefined) return forbidden;
      if (current.version !== input.expectedVersion) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      if (input.commitOutcome === "failure") {
        return { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" };
      }

      const retired: RegisteredCardCommandRecord = {
        ...current,
        lifecycle: "retired",
        version: current.version + 1,
      };
      cards = cards.map((card, cardIndex) =>
        cardIndex === index ? retired : card,
      );
      claims = claims.filter(({ cardId }) => cardId !== current.cardId);
      return { kind: "Retired", card: cloneCard(retired) };
    },

    reorder(input) {
      const householdForbidden = authorizeHousehold(input.actor);
      if (householdForbidden !== undefined) return householdForbidden;
      if (input.ownerMemberId !== input.actor.memberId) {
        return { kind: "Forbidden", code: "OWNER_FORBIDDEN" };
      }
      if (new Set(input.orderedCardIds).size !== input.orderedCardIds.length) {
        return { kind: "Rejected", code: "DUPLICATE_CARD_ID" };
      }

      const activeCards = cards.filter(
        (card) =>
          card.householdId === input.actor.householdId &&
          card.ownerMemberId === input.ownerMemberId &&
          card.lifecycle === "active",
      );
      const activeIds = new Set(activeCards.map(({ cardId }) => cardId));
      if (input.orderedCardIds.some((cardId) => !activeIds.has(cardId))) {
        return { kind: "Rejected", code: "FOREIGN_CARD_ID" };
      }
      if (input.orderedCardIds.length !== activeCards.length) {
        return { kind: "Rejected", code: "INCOMPLETE_CARD_SET" };
      }

      const key = collectionKey(input.actor.householdId, input.ownerMemberId);
      const currentVersion = collectionVersions[key] ?? 0;
      if (currentVersion !== input.expectedCollectionVersion) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      if (input.commitOutcome === "failure") {
        return { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" };
      }

      const orderById = new Map(
        input.orderedCardIds.map((cardId, order) => [cardId, order]),
      );
      cards = cards.map((card) =>
        orderById.has(card.cardId)
          ? { ...card, order: orderById.get(card.cardId) as number }
          : card,
      );
      collectionVersions = {
        ...collectionVersions,
        [key]: currentVersion + 1,
      };
      return {
        kind: "Reordered",
        orderedCardIds: [...input.orderedCardIds],
        collectionVersion: currentVersion + 1,
      };
    },

    searchHistorical(input) {
      if (input.actor.householdId !== options.boundaryHouseholdId) return [];
      const query = normalizeMerchantText(input.query);
      return historicalEvidence
        .filter((evidence) => {
          if (evidence.householdId !== input.actor.householdId) return false;
          const searchable = normalizeMerchantText(
            [
              evidence.cardCompanyLabel,
              evidence.lastFour,
              evidence.lastFour === undefined
                ? undefined
                : `${evidence.cardCompanyLabel}(${evidence.lastFour})`,
            ]
              .filter((value): value is string => value !== undefined)
              .join(" "),
          );
          return searchable.includes(query);
        })
        .map((evidence) => ({ ...evidence }));
    },

    availableCommands() {
      return [
        "RegisterCard",
        "UpdateRegisteredCardLastFour",
        "RetireRegisteredCard",
        "ReorderCards",
      ];
    },

    state(): RegisteredCardCommandState {
      return {
        cards: cards.map(cloneCard),
        claims: claims.map((claim) => ({ ...claim })),
        historicalEvidence: historicalEvidence.map((item) => ({ ...item })),
        collectionVersions: { ...collectionVersions },
      };
    },
  };
}
