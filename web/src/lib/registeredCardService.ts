import {
  collection,
  doc,
  onSnapshot,
  db,
} from '@/platform/read-model/firestoreReadModel';
import {
  CreateRegisteredCardInput,
  NUMBERLESS_REGISTERED_CARD_LABELS,
  RegisteredCard,
  mapRegisteredCardDocument,
} from '@/types/registeredCard';
import { paymentConfigurationCommands } from '@/features/payment-configuration/application/paymentConfigurationCommands';
import { requireClientSessionScope } from '@/composition/clientSessionScope';

const NUMBERLESS_SORT_WEIGHT = 1000;

function requireHouseholdId(): string {
  return requireClientSessionScope().householdId;
}

function normalizeCardLastFour(value: string | undefined): string {
  return (value || '').replace(/\D/g, '').slice(-4);
}

function getCardSortWeight(card: Pick<RegisteredCard, 'cardLabel'>): number {
  return NUMBERLESS_REGISTERED_CARD_LABELS.has(card.cardLabel as never) ? NUMBERLESS_SORT_WEIGHT : 0;
}

function sortRegisteredCards(cards: RegisteredCard[]): RegisteredCard[] {
  return [...cards].sort((a, b) => {
    const aHasOrder = typeof a.orderIndex === 'number';
    const bHasOrder = typeof b.orderIndex === 'number';

    if (aHasOrder && bHasOrder && a.orderIndex !== b.orderIndex) {
      return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
    }

    if (aHasOrder !== bHasOrder) {
      return aHasOrder ? -1 : 1;
    }

    const weightDiff = getCardSortWeight(a) - getCardSortWeight(b);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    if (a.cardLabel !== b.cardLabel) {
      return a.cardLabel.localeCompare(b.cardLabel, 'ko');
    }

    const lastFourDiff = a.cardLastFour.localeCompare(b.cardLastFour, 'ko');
    if (lastFourDiff !== 0) {
      return lastFourDiff;
    }

    return a.id.localeCompare(b.id, 'ko');
  });
}

export interface RegisteredCardSubscriptionScope {
  householdId: string | null | undefined;
  ownerMemberId: string | null | undefined;
  legacyOwnerName: string | null | undefined;
}

export function subscribeToRegisteredCards(
  scope: RegisteredCardSubscriptionScope,
  callback: (cards: RegisteredCard[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const { householdId, ownerMemberId, legacyOwnerName } = scope;

  if (!householdId || !ownerMemberId) {
    callback([]);
    return () => {};
  }

  const cardsCollection = collection(
    db,
    'households',
    householdId,
    'registeredCards'
  );

  let latestCards: RegisteredCard[] | undefined;
  let collectionVersion: number | undefined;
  const publish = () => {
    if (latestCards !== undefined && collectionVersion !== undefined) callback(sortRegisteredCards(latestCards.map((card) => ({ ...card, collectionVersion }))));
  };
  const stopMeta = onSnapshot(doc(db, 'households', householdId, 'paymentConfigurationMeta', 'registered-cards'), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return;
    const versions = snapshot.data()?.collectionVersions;
    collectionVersion = versions?.[`${householdId}:${ownerMemberId}`] ?? 0;
    publish();
  }, (error) => onError?.(error));
  const stopCards = onSnapshot(
    cardsCollection,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.fromCache) {
        return;
      }

      const cards = snapshot.docs
        .map((cardDoc) => mapRegisteredCardDocument(cardDoc.id, cardDoc.data()))
        .filter((card) => card.lifecycle === 'active')
        .filter((card) =>
          card.ownerMemberId
            ? card.ownerMemberId === ownerMemberId
            : Boolean(legacyOwnerName && card.owner === legacyOwnerName)
        );

      latestCards = cards;
      publish();
    },
    (error) => onError?.(error)
  );
  return () => { stopCards(); stopMeta(); };
}

export async function addRegisteredCard(input: CreateRegisteredCardInput): Promise<string> {
  const normalizedLastFour = normalizeCardLastFour(input.cardLastFour);
  const householdId = input.householdId.trim();
  const owner = input.owner.trim();
  const cardLabel = input.cardLabel.trim();

  if (!householdId || !owner || !cardLabel) {
    return '';
  }

  return paymentConfigurationCommands.registerCard(householdId, {
    cardLabel,
    cardLastFour: normalizedLastFour,
  });
}

export async function deleteRegisteredCard(cardId: string, expectedVersion: number): Promise<void> {
  await paymentConfigurationCommands.deleteCard(requireHouseholdId(), cardId, expectedVersion);
}

export async function updateRegisteredCard(input: {
  cardId: string;
  expectedVersion: number;
  householdId: string;
  owner: string;
  cardLabel: string;
  cardLastFour?: string;
}): Promise<boolean> {
  const normalizedLastFour = normalizeCardLastFour(input.cardLastFour);
  const householdId = input.householdId.trim();
  const owner = input.owner.trim();
  const cardLabel = input.cardLabel.trim();
  const cardId = input.cardId.trim();

  if (!householdId || !owner || !cardLabel || !cardId) {
    return false;
  }

  return paymentConfigurationCommands.updateCard(householdId, cardId, {
    cardLabel,
    cardLastFour: normalizedLastFour,
  }, input.expectedVersion);
}

export async function updateRegisteredCardOrder(cardIds: string[], expectedCollectionVersion: number): Promise<void> {
  if (cardIds.length === 0) {
    return;
  }

  await paymentConfigurationCommands.reorderCards(requireHouseholdId(), cardIds, expectedCollectionVersion);
}
