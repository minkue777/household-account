import { resolveHomeSummaryConfig } from '@/features/home-preferences/application/homeSummaryConfig';
import {
  collection,
  doc,
  getDocFromServer,
  db,
  timestampToDate,
  type DocumentData,
  type DocumentSnapshot,
} from '@/platform/read-model/firestoreReadModel';
import {
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
function mapHouseholdSnapshot(docSnap: DocumentSnapshot<DocumentData>): Household | null {
  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  return {
    id: docSnap.id,
    name: data.name,
    createdAt: timestampToDate(data.createdAt) || new Date(),
    defaultCategoryKey: data.defaultCategoryKey,
    categoryCatalogVersion: Number.isInteger(data.categoryCatalogVersion) ? data.categoryCatalogVersion : 0,
    ...(['pending', 'failed', 'completed'].includes(data.initializationStatus)
      ? { initializationStatus: data.initializationStatus } : {}),
    homeSummaryConfig: resolveHomeSummaryConfig(data.homeSummaryConfig),
    homeSummaryConfigVersion: Number.isInteger(data.homeSummaryConfigVersion) ? data.homeSummaryConfigVersion : 0,
    selectedLocalCurrencyType: typeof data.selectedLocalCurrencyType === 'string' ? data.selectedLocalCurrencyType : undefined,
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
  const household = mapHouseholdSnapshot(
    await getDocFromServer(doc(householdsCollection, key))
  );
  if (!household) throw new HouseholdReadNotFoundError(key);
  return household;
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

export async function setDefaultCategoryKey(
  householdKey: string,
  categoryKey: string,
  expectedCatalogVersion: number
): Promise<void> {
  const { categoryCommands } = await import(
    '@/features/category-budget/application/categoryCommands'
  );
  await categoryCommands.setDefault(householdKey, categoryKey, expectedCatalogVersion);
}
