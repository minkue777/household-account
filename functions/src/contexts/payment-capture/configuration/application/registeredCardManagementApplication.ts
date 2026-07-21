import type {
  CardBoundaryFailure,
  RegisterCardCommand,
  RegisterCardResult,
  RegisteredCardActor,
  RegisteredCardManagementInputPort,
  RegisteredCardView,
  ResolveRegisteredCardResult,
  RetireCardResult,
  RetireRegisteredCardCommand,
  UpdateCardResult,
  UpdateRegisteredCardCommand,
} from "./ports/in/registeredCardManagementInputPort";
import type {
  RegisteredCardIdPort,
  RegisteredCardRegistryStorePort,
} from "./ports/out/registeredCardRegistryStorePort";
import type {
  RegisteredCard,
  RegisteredCardClaim,
  RegisteredCardRegistry,
} from "../domain/model/registeredCardRegistry";
import {
  decideRegisteredCardIdentityUpdate,
  normalizeCardIdentity,
  registeredCardClaimKey,
} from "../domain/policies/registeredCardIdentity";
import {
  listActiveOwnCards,
  resolveOwnCard,
} from "../domain/policies/ownCardResolution";

export interface RegisteredCardManagementDependencies {
  readonly store: RegisteredCardRegistryStorePort;
  readonly ids: RegisteredCardIdPort;
}

function toView(card: RegisteredCard): RegisteredCardView {
  return { ...card };
}

function unchanged<T>(
  registry: RegisteredCardRegistry,
  value: T,
): { registry: RegisteredCardRegistry; value: T } {
  return { registry, value };
}

function authorizeCard(
  actor: RegisteredCardActor,
  card: RegisteredCard,
): CardBoundaryFailure | undefined {
  if (actor.householdId !== card.householdId) {
    return { kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" };
  }
  if (actor.memberId !== card.ownerMemberId) {
    return { kind: "Forbidden", code: "OWNER_FORBIDDEN" };
  }
  return undefined;
}

function claimFor(card: RegisteredCard): RegisteredCardClaim {
  return {
    claimKey: registeredCardClaimKey(card),
    householdId: card.householdId,
    ownerMemberId: card.ownerMemberId,
    cardCompany: card.cardCompany,
    lastFour: card.lastFour,
    cardId: card.cardId,
  };
}

class DefaultRegisteredCardManagementApplication
  implements RegisteredCardManagementInputPort
{
  constructor(
    private readonly dependencies: RegisteredCardManagementDependencies,
  ) {}

  async register(input: RegisterCardCommand): Promise<RegisterCardResult> {
    if (input.actor.householdId !== input.householdId) {
      return { kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" };
    }
    if (input.actor.memberId !== input.ownerMemberId) {
      return { kind: "Forbidden", code: "OWNER_FORBIDDEN" };
    }

    const identity = normalizeCardIdentity({
      cardCompany: input.cardCompany,
      rawCardNumber: input.cardNumber,
    });
    if (identity.kind === "rejected") {
      return { kind: "Rejected", code: identity.code };
    }

    return this.dependencies.store.transact<RegisterCardResult>((current) => {
      const claimKey = registeredCardClaimKey({
        householdId: input.householdId,
        ownerMemberId: input.ownerMemberId,
        cardCompany: identity.cardCompany,
        lastFour: identity.lastFour,
      });
      const occupied = current.activeClaims.find(
        (claim) => claim.claimKey === claimKey,
      );
      if (occupied !== undefined) {
        return unchanged(current, {
          kind: "Duplicate" as const,
          existingCardId: occupied.cardId,
        });
      }

      const orderIndex =
        current.cards
          .filter(
            (card) =>
              card.lifecycleState === "active" &&
              card.householdId === input.householdId &&
              card.ownerMemberId === input.ownerMemberId,
          )
          .reduce(
            (maximum, card) =>
              typeof card.orderIndex === "number" &&
              Number.isFinite(card.orderIndex)
                ? Math.max(maximum, card.orderIndex)
                : maximum,
            -1,
          ) + 1;
      const card: RegisteredCard = {
        cardId: this.dependencies.ids.nextCardId(input.commandId),
        householdId: input.householdId,
        ownerMemberId: input.ownerMemberId,
        cardCompany: identity.cardCompany,
        lastFour: identity.lastFour,
        orderIndex,
        lifecycleState: "active",
        version: 1,
      };

      return {
        registry: {
          cards: [...current.cards, card],
          activeClaims: [...current.activeClaims, claimFor(card)],
        },
        value: { kind: "Registered", card: toView(card) },
      };
    });
  }

  async update(input: UpdateRegisteredCardCommand): Promise<UpdateCardResult> {
    return this.dependencies.store.transact<UpdateCardResult>((current) => {
      const target = current.cards.find(({ cardId }) => cardId === input.cardId);
      if (target === undefined) {
        return unchanged(current, { kind: "NotFound" as const });
      }

      const forbidden = authorizeCard(input.actor, target);
      if (forbidden !== undefined) {
        return unchanged(current, forbidden);
      }

      const identityDecision = decideRegisteredCardIdentityUpdate({
        current: target,
        requestedOwnerMemberId: input.requestedOwnerMemberId,
        requestedCardCompany: input.requestedCardCompany,
        customAlias: input.customAlias,
      });
      if (identityDecision.kind === "rejected") {
        return unchanged(current, {
          kind: "Rejected" as const,
          code: identityDecision.code,
        });
      }

      if (target.lifecycleState === "retired") {
        return unchanged(current, {
          kind: "Rejected" as const,
          code: "CARD_RETIRED" as const,
        });
      }
      if (target.version !== input.expectedVersion) {
        return unchanged(current, {
          kind: "Conflict" as const,
          code: "VERSION_MISMATCH" as const,
        });
      }
      if (input.lastFour === undefined) {
        return unchanged(current, {
          kind: "Updated" as const,
          card: toView(target),
        });
      }

      const normalized = normalizeCardIdentity({
        cardCompany: target.cardCompany,
        rawCardNumber: input.lastFour,
      });
      if (normalized.kind === "rejected") {
        return unchanged(current, {
          kind: "Rejected" as const,
          code: "INVALID_LAST_FOUR" as const,
        });
      }
      if (normalized.lastFour === target.lastFour) {
        return unchanged(current, {
          kind: "Updated" as const,
          card: toView(target),
        });
      }

      const updated: RegisteredCard = {
        ...target,
        lastFour: normalized.lastFour,
        version: target.version + 1,
      };
      const newClaim = claimFor(updated);
      const occupied = current.activeClaims.find(
        (claim) =>
          claim.claimKey === newClaim.claimKey && claim.cardId !== target.cardId,
      );
      if (occupied !== undefined) {
        return unchanged(current, {
          kind: "Duplicate" as const,
          existingCardId: occupied.cardId,
        });
      }

      return {
        registry: {
          cards: current.cards.map((card) =>
            card.cardId === target.cardId ? updated : card,
          ),
          activeClaims: [
            ...current.activeClaims.filter(
              (claim) => claim.cardId !== target.cardId,
            ),
            newClaim,
          ],
        },
        value: { kind: "Updated", card: toView(updated) },
      };
    });
  }

  async retire(input: RetireRegisteredCardCommand): Promise<RetireCardResult> {
    return this.dependencies.store.transact<RetireCardResult>((current) => {
      const target = current.cards.find(({ cardId }) => cardId === input.cardId);
      if (target === undefined) {
        return unchanged(current, { kind: "NotFound" as const });
      }

      const forbidden = authorizeCard(input.actor, target);
      if (forbidden !== undefined) {
        return unchanged(current, forbidden);
      }
      if (target.version !== input.expectedVersion) {
        return unchanged(current, {
          kind: "Conflict" as const,
          code: "VERSION_MISMATCH" as const,
        });
      }
      if (target.lifecycleState === "retired") {
        return unchanged(current, {
          kind: "Retired" as const,
          card: toView(target),
        });
      }

      const retired: RegisteredCard = {
        ...target,
        lifecycleState: "retired",
        version: target.version + 1,
      };
      return {
        registry: {
          cards: current.cards.map((card) =>
            card.cardId === target.cardId ? retired : card,
          ),
          activeClaims: current.activeClaims.filter(
            (claim) => claim.cardId !== target.cardId,
          ),
        },
        value: { kind: "Retired", card: toView(retired) },
      };
    });
  }

  listActive(actor: RegisteredCardActor): readonly RegisteredCardView[] {
    const householdCards = this.dependencies.store
      .read()
      .cards.filter((card) => card.householdId === actor.householdId);
    return listActiveOwnCards({
      actingMemberId: actor.memberId,
      cards: householdCards,
    }).map(toView);
  }

  resolve(input: {
    readonly actor: RegisteredCardActor;
    readonly cardCompany: string;
    readonly cardToken?: string;
  }): ResolveRegisteredCardResult {
    const householdCards = this.dependencies.store
      .read()
      .cards.filter((card) => card.householdId === input.actor.householdId);
    const resolved = resolveOwnCard({
      actingMemberId: input.actor.memberId,
      evidence: {
        companyLabel: input.cardCompany,
        maskedToken: input.cardToken,
      },
      cards: householdCards,
    });

    return resolved.kind === "eligible"
      ? {
          kind: "Eligible",
          ...(resolved.canonicalEvidence === undefined
            ? {}
            : { canonicalEvidence: resolved.canonicalEvidence }),
        }
      : { kind: "Unmatched" };
  }
}

export function createRegisteredCardManagementApplication(
  dependencies: RegisteredCardManagementDependencies,
): RegisteredCardManagementInputPort {
  return new DefaultRegisteredCardManagementApplication(dependencies);
}
