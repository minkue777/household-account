import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import type { CategoryDocument } from '@/types/category';

export const categoryCommands = {
  async create(
    householdId: string,
    category: Omit<CategoryDocument, 'id' | 'householdId' | 'isDefault'>
  ): Promise<string> {
    const result = await getHouseholdCommandClient().execute(
      'category.create.v1',
      { category: { ...category } },
      { householdId }
    );
    return result.categoryId;
  },

  async update(
    householdId: string,
    categoryId: string,
    changes: Partial<Omit<CategoryDocument, 'id' | 'householdId' | 'isDefault'>>
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'category.update.v1',
      { categoryId, changes: { ...changes } },
      { householdId }
    );
  },

  async archive(householdId: string, categoryId: string): Promise<void> {
    await getHouseholdCommandClient().execute(
      'category.archive.v1',
      { categoryId },
      { householdId }
    );
  },

  async setBudget(householdId: string, categoryId: string, budget: number | null): Promise<void> {
    await getHouseholdCommandClient().execute(
      'category.set-budget.v1',
      { categoryId, budget },
      { householdId }
    );
  },

  async reorder(
    householdId: string,
    categories: ReadonlyArray<{ id: string; order: number }>
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'category.reorder.v1',
      { categories: categories.map(({ id, order }) => ({ categoryId: id, order })) },
      { householdId }
    );
  },

  async setDefault(householdId: string, categoryId: string): Promise<void> {
    await getHouseholdCommandClient().execute(
      'category.set-default.v1',
      { categoryId },
      { householdId }
    );
  },
};
