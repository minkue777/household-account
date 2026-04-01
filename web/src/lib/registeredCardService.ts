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
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  CreateRegisteredCardInput,
  RegisteredCard,
  mapRegisteredCardDocument,
} from '@/types/registeredCard';

const COLLECTION_NAME = 'registered_cards';

function normalizeCardLastFour(value: string | undefined): string {
  return (value || '').replace(/\D/g, '').slice(-4);
}

function sortRegisteredCards(cards: RegisteredCard[]): RegisteredCard[] {
  return [...cards].sort((a, b) => {
    if (a.cardLabel !== b.cardLabel) {
      return a.cardLabel.localeCompare(b.cardLabel, 'ko');
    }

    return a.cardLastFour.localeCompare(b.cardLastFour, 'ko');
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
        .filter((card) => card.owner === owner)
        .filter((card) => card.isActive);

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

  const documentRef = await addDoc(collection(db, COLLECTION_NAME), {
    householdId,
    owner,
    cardLabel,
    cardLastFour: normalizedLastFour,
    isActive: true,
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
