import { normalizeCardCompanyKey } from "../domain/value-objects/cardIdentity";
import type { RegisteredCardCommandActor, RegisteredCardCommandBoundaryInputPort as Commands,
  RegisteredCardCommandRecord as Card, RegisteredCardCommandState as State,
  RegisteredCardCommandResult as Result } from "./ports/in/registeredCardCommandBoundaryInputPort";
import type { AtomicPaymentConfigurationMutation } from "./ports/out/paymentConfigurationAtomicStorePort";

export type CardMutation = AtomicPaymentConfigurationMutation<State, Result>;

export function unchangedCards(state: State, value: Result): CardMutation {
  return { state, value, writes: false };
}

function claimFor(card: Card): State["claims"][number] {
  return { householdId: card.householdId, ownerMemberId: card.ownerMemberId, cardCompanyCode: card.cardCompanyCode,
    ...(card.lastFour === undefined ? {} : { lastFour: card.lastFour }), cardId: card.cardId };
}

export function cardState(cards: readonly Card[], collectionVersions: State["collectionVersions"] = {}): State {
  return { cards, claims: cards.filter(card => card.lifecycle === "active").map(claimFor), collectionVersions };
}

function changed(state: State, cards: readonly Card[], value: Result, versions = state.collectionVersions): CardMutation {
  return { state: cardState(cards, versions), value, writes: true };
}

function forbidden(actor: RegisteredCardCommandActor, householdId: string, ownerMemberId: string): Result | undefined {
  if (actor.householdId !== householdId) return { kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" };
  if (actor.memberId !== ownerMemberId) return { kind: "Forbidden", code: "OWNER_FORBIDDEN" };
  return undefined;
}

function duplicate(state: State, card: Card): boolean {
  return state.cards.some(existing => existing.cardId !== card.cardId && existing.lifecycle === "active"
    && existing.householdId === card.householdId && existing.ownerMemberId === card.ownerMemberId
    && normalizeCardCompanyKey(existing.cardCompanyCode) === normalizeCardCompanyKey(card.cardCompanyCode)
    && existing.lastFour === card.lastFour);
}

function lastFour(raw?: string): { kind: "valid"; value?: string } | { kind: "invalid" } {
  if (raw === undefined || raw.trim() === "") return { kind: "valid" };
  const trimmed = raw.trim();
  if (/^\d{4}$/.test(trimmed)) return { kind: "valid", value: trimmed };
  if (!/^[\d\s-]+$/.test(trimmed)) return { kind: "invalid" };
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 12 && digits.length <= 19 ? { kind: "valid", value: digits.slice(-4) } : { kind: "invalid" };
}

export function registerCardMutation(state: State, householdId: string, input: Parameters<Commands["register"]>[0]): CardMutation {
  const denied = forbidden(input.actor, householdId, input.ownerMemberId);
  if (denied) return unchangedCards(state, denied);
  const normalized = lastFour(input.rawLastFour);
  if (normalized.kind === "invalid") return unchangedCards(state, { kind: "Rejected", code: "INVALID_LAST_FOUR" });
  if (state.cards.some(card => card.cardId === input.cardId)) return unchangedCards(state, { kind: "Conflict", code: "DUPLICATE_CARD" });
  const order = state.cards.filter(card => card.householdId === householdId && card.ownerMemberId === input.ownerMemberId && card.lifecycle === "active")
    .reduce((maximum, card) => Math.max(maximum, card.order), -1) + 1;
  const card: Card = { cardId: input.cardId, householdId, ownerMemberId: input.ownerMemberId, cardCompanyCode: input.cardCompanyCode,
    ...(normalized.value === undefined ? {} : { lastFour: normalized.value }), order, version: 1, lifecycle: "active" };
  if (duplicate(state, card)) return unchangedCards(state, { kind: "Conflict", code: "DUPLICATE_CARD" });
  return changed(state, [...state.cards, card], { kind: "Created", card });
}

function currentCard(state: State, householdId: string, input: { actor: RegisteredCardCommandActor; cardId: string; expectedVersion: number }): Card | Result {
  const current = state.cards.find(card => card.cardId === input.cardId);
  if (!current) return { kind: "NotFound" };
  const denied = forbidden(input.actor, householdId, current.ownerMemberId)
    ?? (current.householdId !== householdId ? { kind: "Forbidden" as const, code: "HOUSEHOLD_FORBIDDEN" as const } : undefined);
  if (denied) return denied;
  if (current.version !== input.expectedVersion) return { kind: "Conflict", code: "VERSION_MISMATCH" };
  return current;
}

export function updateCardMutation(state: State, householdId: string, input: Parameters<Commands["updateLastFour"]>[0]): CardMutation {
  const current = currentCard(state, householdId, input);
  if ("kind" in current) return unchangedCards(state, current);
  const normalized = lastFour(input.rawLastFour);
  if (normalized.kind === "invalid") return unchangedCards(state, { kind: "Rejected", code: "INVALID_LAST_FOUR" });
  const { lastFour: _old, ...withoutNumber } = current;
  const card: Card = { ...withoutNumber, ...(normalized.value === undefined ? {} : { lastFour: normalized.value }), version: current.version + 1 };
  if (duplicate(state, card)) return unchangedCards(state, { kind: "Conflict", code: "DUPLICATE_CARD" });
  return changed(state, state.cards.map(existing => existing.cardId === card.cardId ? card : existing), { kind: "Updated", card });
}

export function retireCardMutation(state: State, householdId: string, input: Parameters<Commands["retire"]>[0]): CardMutation {
  const current = currentCard(state, householdId, input);
  if ("kind" in current) return unchangedCards(state, current);
  const card: Card = { ...current, lifecycle: "retired", version: current.version + 1 };
  return changed(state, state.cards.map(existing => existing.cardId === card.cardId ? card : existing), { kind: "Retired", card });
}

export function reorderCardsMutation(state: State, householdId: string, input: Parameters<Commands["reorder"]>[0]): CardMutation {
  const denied = forbidden(input.actor, householdId, input.ownerMemberId);
  if (denied) return unchangedCards(state, denied);
  if (new Set(input.orderedCardIds).size !== input.orderedCardIds.length) return unchangedCards(state, { kind: "Rejected", code: "DUPLICATE_CARD_ID" });
  const active = state.cards.filter(card => card.householdId === householdId && card.ownerMemberId === input.ownerMemberId && card.lifecycle === "active");
  const activeIds = new Set(active.map(card => card.cardId));
  if (input.orderedCardIds.some(id => !activeIds.has(id))) return unchangedCards(state, { kind: "Rejected", code: "FOREIGN_CARD_ID" });
  if (input.orderedCardIds.length !== active.length) return unchangedCards(state, { kind: "Rejected", code: "INCOMPLETE_CARD_SET" });
  const key = `${householdId}:${input.ownerMemberId}`;
  const version = state.collectionVersions[key] ?? 0;
  if (version !== input.expectedCollectionVersion) return unchangedCards(state, { kind: "Conflict", code: "VERSION_MISMATCH" });
  const orders = new Map(input.orderedCardIds.map((id, order) => [id, order]));
  return changed(state, state.cards.map(card => orders.has(card.cardId) ? { ...card, order: orders.get(card.cardId)! } : card),
    { kind: "Reordered", orderedCardIds: [...input.orderedCardIds], collectionVersion: version + 1 },
    { ...state.collectionVersions, [key]: version + 1 });
}

