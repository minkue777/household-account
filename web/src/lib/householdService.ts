import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  db,
  timestampToDate,
  type DocumentData,
  type DocumentSnapshot,
} from '@/platform/read-model/firestoreReadModel';
import {
  DEFAULT_HOME_SUMMARY_CONFIG,
  HomeSummaryCardKey,
  HomeSummaryConfig,
  Household,
  HouseholdMember,
} from '@/types/household';

export type { Household };

export class HouseholdReadNotFoundError extends Error {
  constructor(readonly householdId: string) {
    super('HOUSEHOLD_READ_NOT_FOUND');
    this.name = 'HouseholdReadNotFoundError';
  }
}

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

function mapHouseholdSnapshot(docSnap: DocumentSnapshot<DocumentData>): Household | null {
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

export async function getHousehold(key: string): Promise<Household> {
  const household = mapHouseholdSnapshot(await getDoc(doc(householdsCollection, key)));
  if (!household) throw new HouseholdReadNotFoundError(key);
  return household;
}

/** Android의 영속 read cache에 있는 마지막 확인 가구를 네트워크보다 먼저 읽습니다. */
export async function getCachedHousehold(key: string): Promise<Household | null> {
  try {
    return mapHouseholdSnapshot(await getDocFromCache(doc(householdsCollection, key)));
  } catch {
    return null;
  }
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
  const { householdCommands } = await import(
    '@/features/access-household/application/householdCommands'
  );
  await householdCommands.renameSelf(householdKey, newName, expectedVersion);
}

export async function deleteHousehold(key: string): Promise<void> {
  const { householdCommands } = await import(
    '@/features/access-household/application/householdCommands'
  );
  await householdCommands.deleteHousehold(key);
}

export async function setDefaultCategoryKey(
  householdKey: string,
  categoryKey: string
): Promise<void> {
  const { categoryCommands } = await import(
    '@/features/category-budget/application/categoryCommands'
  );
  await categoryCommands.setDefault(householdKey, categoryKey);
}
