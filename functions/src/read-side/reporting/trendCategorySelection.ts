export interface TrendCategory {
  categoryId: string;
  active: boolean;
  budgetOrder?: number;
}

export function selectInitialTrendCategories(
  categories: readonly TrendCategory[],
  compatibilityDefaults: readonly string[],
): readonly string[] {
  const budgetCategories = categories
    .map((category, fixtureOrder) => ({ category, fixtureOrder }))
    .filter(
      ({ category }) => category.active && category.budgetOrder !== undefined,
    )
    .sort(
      (left, right) =>
        (left.category.budgetOrder as number) -
          (right.category.budgetOrder as number) ||
        left.fixtureOrder - right.fixtureOrder,
    )
    .map(({ category }) => category.categoryId);

  if (budgetCategories.length > 0) return budgetCategories;

  const activeIds = new Set(
    categories
      .filter((category) => category.active)
      .map((category) => category.categoryId),
  );
  return compatibilityDefaults.filter((categoryId) => activeIds.has(categoryId));
}
