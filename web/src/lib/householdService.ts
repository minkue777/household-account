import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  DEFAULT_HOME_SUMMARY_CONFIG,
  HomeSummaryCardKey,
  HomeSummaryConfig,
  Household,
  HouseholdMember,
} from '@/types/household';
import { HouseholdStorage } from './storage/householdStorage';

export type { Household };

const householdsCollection = collection(db, 'households');
const HOME_SUMMARY_CARD_KEYS: HomeSummaryCardKey[] = [
  'localCurrencyBalance',
  'monthlyRemainingBudget',
  'monthlySpent',
  'yearlySpent',
];

function generateKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 20; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function isHomeSummaryCardKey(value: unknown): value is HomeSummaryCardKey {
  return typeof value === 'string' && HOME_SUMMARY_CARD_KEYS.includes(value as HomeSummaryCardKey);
}

function resolveHomeSummaryConfig(value: unknown): HomeSummaryConfig {
  const leftCard =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>).leftCard : null;
  const rightCard =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>).rightCard : null;

  return {
    leftCard: isHomeSummaryCardKey(leftCard)
      ? leftCard
      : DEFAULT_HOME_SUMMARY_CONFIG.leftCard,
    rightCard: isHomeSummaryCardKey(rightCard)
      ? rightCard
      : DEFAULT_HOME_SUMMARY_CONFIG.rightCard,
  };
}

export async function createHousehold(name?: string, customKey?: string): Promise<string> {
  let key = customKey || generateKey();

  if (!customKey) {
    let exists = await getDoc(doc(householdsCollection, key));
    while (exists.exists()) {
      key = generateKey();
      exists = await getDoc(doc(householdsCollection, key));
    }
  }

  await setDoc(doc(householdsCollection, key), {
    name: name || key,
    createdAt: serverTimestamp(),
    defaultCategoryKey: 'etc',
    homeSummaryConfig: DEFAULT_HOME_SUMMARY_CONFIG,
  });

  return key;
}

export async function validateHouseholdKey(key: string): Promise<boolean> {
  const docRef = doc(householdsCollection, key);
  const docSnap = await getDoc(docRef);
  return docSnap.exists();
}

export async function getHousehold(key: string): Promise<Household | null> {
  const docRef = doc(householdsCollection, key);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  return {
    id: docSnap.id,
    name: data.name,
    createdAt: data.createdAt?.toDate() || new Date(),
    defaultCategoryKey: data.defaultCategoryKey,
    homeSummaryConfig: resolveHomeSummaryConfig(data.homeSummaryConfig),
    members: data.members || [],
  };
}

export async function getAllHouseholds(): Promise<Household[]> {
  const snapshot = await getDocs(householdsCollection);
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name,
      createdAt: data.createdAt?.toDate() || new Date(),
      defaultCategoryKey: data.defaultCategoryKey,
      homeSummaryConfig: resolveHomeSummaryConfig(data.homeSummaryConfig),
      members: data.members || [],
    };
  });
}

export async function addHouseholdMember(
  householdKey: string,
  name: string
): Promise<HouseholdMember> {
  const docRef = doc(householdsCollection, householdKey);
  const docSnap = await getDoc(docRef);

  const id = `m_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const newMember: HouseholdMember = { id, name };

  const currentMembers: HouseholdMember[] = docSnap.data()?.members || [];
  await updateDoc(docRef, {
    members: [...currentMembers, newMember],
  });

  return newMember;
}

export async function deleteHousehold(key: string): Promise<void> {
  await deleteDoc(doc(householdsCollection, key));
}

export async function setDefaultCategoryKey(
  householdKey: string,
  categoryKey: string
): Promise<void> {
  const docRef = doc(householdsCollection, householdKey);
  await updateDoc(docRef, { defaultCategoryKey: categoryKey });
}

export function getStoredHouseholdKey(): string | null {
  return HouseholdStorage.get();
}

export function setStoredHouseholdKey(key: string): void {
  HouseholdStorage.set(key);
}

export function clearStoredHouseholdKey(): void {
  HouseholdStorage.clear();
}

export async function migrateExpensesToHousehold(householdId: string): Promise<number> {
  const expensesRef = collection(db, 'expenses');
  const snapshot = await getDocs(expensesRef);

  let migratedCount = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (!data.householdId) {
      await setDoc(doc(db, 'expenses', docSnap.id), { ...data, householdId });
      migratedCount++;
    }
  }

  return migratedCount;
}
