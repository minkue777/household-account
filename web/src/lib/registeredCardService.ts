import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  writeBatch,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  CreateRegisteredCardInput,
  NUMBERLESS_REGISTERED_CARD_LABELS,
  RegisteredCard,
  mapRegisteredCardDocument,
} from '@/types/registeredCard';

const COLLECTION_NAME = 'registered_cards';
const NUMBERLESS_SORT_WEIGHT = 1000;

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

export function subscribeToRegisteredCards(
  householdId: string | null | undefined,
  owner: string | null | undefined,
  callback: (cards: RegisteredCard[]) => void
): () => void {
  if (!householdId || !owner) {
    callback([]);
    return () => {};
  }

  const cardsQuery = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  return onSnapshot(
    cardsQuery,
    (snapshot) => {
      const cards = snapshot.docs
        .map((cardDoc) => mapRegisteredCardDocument(cardDoc.id, cardDoc.data()))
        .filter((card) => card.owner === owner);

      callback(sortRegisteredCards(cards));
    },
    () => callback([])
  );
}

export async function addRegisteredCard(input: CreateRegisteredCardInput): Promise<string> {
  const normalizedLastFour = normalizeCardLastFour(input.cardLastFour);
  const householdId = input.householdId.trim();
  const owner = input.owner.trim();
  const cardLabel = input.cardLabel.trim();

  if (!householdId || !owner || !cardLabel) {
    return '';
  }

  const existingCards = await getRegisteredCards(householdId, owner);
  const alreadyExists = existingCards.some(
    (card) => card.cardLabel === cardLabel && card.cardLastFour === normalizedLastFour
  );

  if (alreadyExists) {
    return '';
  }

  const hasOrderedCards = existingCards.some((card) => typeof card.orderIndex === 'number');
  const nextOrderIndex = hasOrderedCards
    ? Math.max(...existingCards.map((card) => card.orderIndex ?? -1), -1) + 1
    : undefined;

  const documentRef = await addDoc(collection(db, COLLECTION_NAME), {
    householdId,
    owner,
    cardLabel,
    cardLastFour: normalizedLastFour,
    ...(typeof nextOrderIndex === 'number' ? { orderIndex: nextOrderIndex } : {}),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  return documentRef.id;
}

export async function deleteRegisteredCard(cardId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION_NAME, cardId));
}

export async function updateRegisteredCard(input: {
  cardId: string;
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

  const existingCards = await getRegisteredCards(householdId, owner);
  const alreadyExists = existingCards.some(
    (card) =>
      card.id !== cardId &&
      card.cardLabel === cardLabel &&
      card.cardLastFour === normalizedLastFour
  );

  if (alreadyExists) {
    return false;
  }

  await updateDoc(doc(db, COLLECTION_NAME, cardId), {
    cardLastFour: normalizedLastFour,
    updatedAt: Timestamp.now(),
  });

  return true;
}

export async function updateRegisteredCardOrder(cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) {
    return;
  }

  const batch = writeBatch(db);
  const updatedAt = Timestamp.now();

  cardIds.forEach((cardId, index) => {
    batch.update(doc(db, COLLECTION_NAME, cardId), {
      orderIndex: index,
      updatedAt,
    });
  });

  await batch.commit();
}

async function getRegisteredCards(
  householdId: string,
  owner: string
): Promise<RegisteredCard[]> {
  const cardsQuery = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  const snapshot = await getDocs(cardsQuery);
  return snapshot.docs
    .map((cardDoc) => mapRegisteredCardDocument(cardDoc.id, cardDoc.data()))
    .filter((card) => card.owner === owner);
}
