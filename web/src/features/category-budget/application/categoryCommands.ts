import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import type { CategoryDocument } from '@/types/category';

async function confirmedVersion(householdId: string, result: { catalogVersion?: number }): Promise<number> {
  if (result.catalogVersion !== undefined) {
    if (!Number.isSafeInteger(result.catalogVersion) || result.catalogVersion < 0) throw new Error('CATEGORY_VERSION_INVALID');
    return result.catalogVersion;
  }
  // 구 서버·receipt 응답에만 필요한 호환 조회입니다. 단계 수로 버전을 추정하지 않습니다.
  const scope = getClientSessionScope();
  if (scope?.householdId !== householdId) throw new Error('CATEGORY_SESSION_CHANGED');
  const { readCategoryCatalogFromServer } = await import('@/lib/categoryService');
  const catalog = await readCategoryCatalogFromServer(householdId);
  if (getClientSessionScope() !== scope) throw new Error('CATEGORY_SESSION_CHANGED');
  return catalog.catalogVersion;
}

export const categoryCommands = {
  async create(
    householdId: string,
    category: Omit<CategoryDocument, 'id' | 'householdId' | 'isDefault'>
  ): Promise<number> {
    const result = await getHouseholdCommandClient().execute(
      'category.create.v1',
      { category: { ...category } },
      { householdId }
    );
    return confirmedVersion(householdId, result);
  },

  async update(
    householdId: string,
    categoryId: string,
    changes: Partial<Omit<CategoryDocument, 'id' | 'householdId' | 'isDefault'>>,
    expectedVersion: number
  ): Promise<number> {
    const result = await getHouseholdCommandClient().execute(
      'category.update.v1',
      { categoryId, changes: { ...changes }, expectedVersion },
      { householdId }
    );
    return confirmedVersion(householdId, result);
  },

  async archive(householdId: string, categoryId: string, expectedVersion: number): Promise<number> {
    const result = await getHouseholdCommandClient().execute(
      'category.archive.v1',
      { categoryId, expectedVersion },
      { householdId }
    );
    return confirmedVersion(householdId, result);
  },

  async setBudget(householdId: string, categoryId: string, budget: number | null, expectedVersion: number): Promise<number> {
    const result = await getHouseholdCommandClient().execute(
      'category.set-budget.v1',
      { categoryId, budget, expectedVersion },
      { householdId }
    );
    return confirmedVersion(householdId, result);
  },

  async reorder(
    householdId: string,
    categories: ReadonlyArray<{ id: string; order: number }>,
    expectedCatalogVersion: number
  ): Promise<number> {
    const result = await getHouseholdCommandClient().execute(
      'category.reorder.v1',
      { categories: categories.map(({ id, order }) => ({ categoryId: id, order })), expectedCatalogVersion },
      { householdId }
    );
    return confirmedVersion(householdId, result);
  },

  async setDefault(householdId: string, categoryId: string, expectedCatalogVersion: number): Promise<number> {
    const result = await getHouseholdCommandClient().execute(
      'category.set-default.v1',
      { categoryId, expectedCatalogVersion },
      { householdId }
    );
    return confirmedVersion(householdId, result);
  },
};
