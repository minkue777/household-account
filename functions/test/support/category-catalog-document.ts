import type { CategoryEntity } from "../../src/contexts/household-finance/categories-budget/domain/model/categoryCatalog";

/** Stored catalog fixture, including every field validated by the runtime adapter. */
export function categoryCatalogDocument(
  householdId: string,
  entries: readonly (Partial<CategoryEntity> & Pick<CategoryEntity, "categoryId">)[],
  options: { defaultCategoryId?: string | null; catalogVersion?: number; categoryAliases?: Record<string, string> } = {},
) {
  return {
    householdId,
    schemaVersion: 1,
    categories: entries.map((entry, index): CategoryEntity => ({
      name: entry.categoryId, color: "#123456", budgetInWon: null, state: "active", sortOrder: index, version: 1, ...entry,
    })),
    defaultCategoryId: options.defaultCategoryId ?? null,
    catalogVersion: options.catalogVersion ?? 1,
    categoryAliases: options.categoryAliases ?? {},
  };
}
