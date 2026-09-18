import type * as firestore from "firebase-admin/firestore";

import type { CategoryEntity } from "../../../contexts/household-finance/categories-budget/domain/model/categoryCatalog";

/** Category Catalog is one aggregate; aliases only bridge historical physical IDs. */
export interface CategoryCatalogDocument {
  readonly categories: readonly CategoryEntity[];
  readonly defaultCategoryId: string | null;
  readonly catalogVersion: number;
  readonly categoryAliases: Readonly<Record<string, string>>;
}

export function categoryCatalogReference(database: firestore.Firestore, householdId: string) {
  return database.collection("households").doc(householdId).collection("categoryCatalog").doc("current");
}

export function readCategoryCatalogDocument(
  data: FirebaseFirestore.DocumentData | undefined,
  householdId: string,
): CategoryCatalogDocument {
  if (data === undefined) return { categories: [], defaultCategoryId: null, catalogVersion: 0, categoryAliases: {} };
  const invalid = (): never => { throw new Error("CATEGORY_CATALOG_INVALID"); };
  if (data.schemaVersion !== 1 || data.householdId !== householdId || !Array.isArray(data.categories)
    || !Number.isSafeInteger(data.catalogVersion) || data.catalogVersion < 0) return invalid();
  const ids = new Set<string>();
  const categories: CategoryEntity[] = data.categories.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return invalid();
    const category = entry as Record<string, unknown>;
    if (typeof category.categoryId !== "string" || !category.categoryId.trim() || ids.has(category.categoryId)
      || typeof category.name !== "string" || !category.name.trim()
      || typeof category.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(category.color)
      || !(category.budgetInWon === null || (Number.isSafeInteger(category.budgetInWon) && (category.budgetInWon as number) >= 0))
      || !["active", "archive-pending", "archived"].includes(category.state as string)
      || !Number.isSafeInteger(category.sortOrder) || (category.sortOrder as number) < 0
      || !Number.isSafeInteger(category.version) || (category.version as number) < 1) return invalid();
    ids.add(category.categoryId);
    return category as unknown as CategoryEntity;
  });
  if (!(data.defaultCategoryId === null || (typeof data.defaultCategoryId === "string"
    && categories.some(category => category.categoryId === data.defaultCategoryId && category.state === "active")))) return invalid();
  const aliases = data.categoryAliases ?? {};
  if (typeof aliases !== "object" || aliases === null || Array.isArray(aliases)
    || Object.entries(aliases).some(([alias, id]) => !alias || typeof id !== "string" || !ids.has(id)
      || (ids.has(alias) && alias !== id))) return invalid();
  return { categories, defaultCategoryId: data.defaultCategoryId, catalogVersion: data.catalogVersion, categoryAliases: aliases };
}

export function resolveCatalogCategoryId(catalog: CategoryCatalogDocument, identifier: string): string | undefined {
  return catalog.categories.some(category => category.categoryId === identifier)
    ? identifier : Object.prototype.hasOwnProperty.call(catalog.categoryAliases, identifier)
      ? catalog.categoryAliases[identifier] : undefined;
}
