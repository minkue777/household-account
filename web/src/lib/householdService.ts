import {
  collection,
  doc,
  getDoc,
  getDocs,
  db,
  timestampToDate,
} from '@/platform/read-model/firestoreReadModel';
import {
  DEFAULT_HOME_SUMMARY_CONFIG,
  HomeSummaryCardKey,
  HomeSummaryConfig,
  Household,
  HouseholdMember,
} from '@/types/household';
import { householdCommands } from '@/features/access-household/application/householdCommands';
import { categoryCommands } from '@/features/category-budget/application/categoryCommands';

export type { Household };

const householdsCollection = collection(db, 'households');
const HOME_SUMMARY_CARD_KEYS: HomeSummaryCardKey[] = [
  'localCurrencyBalance',
  'monthlyRemainingBudget',
  'monthlySpent',
  'yearlySpent',
];

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

export async function getHousehold(key: string): Promise<Household | null> {
  const docRef = doc(householdsCollection, key);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  return {
    id: docSnap.id,
    name: data.name,
    createdAt: timestampToDate(data.createdAt) || new Date(),
    defaultCategoryKey: data.defaultCategoryKey,
    homeSummaryConfig: resolveHomeSummaryConfig(data.homeSummaryConfig),
    members: Array.isArray(data.members)
      ? data.members.map((member: Record<string, unknown>) => ({
          id: String(member.id || ''),
          name: String(member.name || ''),
          aggregateVersion:
            Number.isInteger(member.aggregateVersion) && Number(member.aggregateVersion) > 0
              ? Number(member.aggregateVersion)
              : 1,
        }))
      : [],
  };
}

export async function getAllHouseholds(): Promise<Household[]> {
  const snapshot = await getDocs(householdsCollection);
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name,
      createdAt: timestampToDate(data.createdAt) || new Date(),
      defaultCategoryKey: data.defaultCategoryKey,
      homeSummaryConfig: resolveHomeSummaryConfig(data.homeSummaryConfig),
      members: Array.isArray(data.members)
        ? data.members.map((member: Record<string, unknown>) => ({
            id: String(member.id || ''),
            name: String(member.name || ''),
            aggregateVersion:
              Number.isInteger(member.aggregateVersion) && Number(member.aggregateVersion) > 0
                ? Number(member.aggregateVersion)
                : 1,
          }))
        : [],
    };
  });
}

export async function renameHouseholdMember(
  householdKey: string,
  _memberId: string,
  newName: string,
  expectedVersion: number
): Promise<void> {
  await householdCommands.renameSelf(householdKey, newName, expectedVersion);
}

export async function deleteHousehold(key: string): Promise<void> {
  await householdCommands.deleteHousehold(key);
}

export async function setDefaultCategoryKey(
  householdKey: string,
  categoryKey: string
): Promise<void> {
  await categoryCommands.setDefault(householdKey, categoryKey);
}
