import type * as firestore from "firebase-admin/firestore";
import { categoryCatalogReference, readCategoryCatalogDocument } from "./categoryCatalogDocument";

/** Read the authoritative catalog once, preserving historical aliases for existing references. */
export async function readUsableCategoryIds(
  database: firestore.Firestore,
  householdId: string,
): Promise<ReadonlySet<string>> {
  const catalog = readCategoryCatalogDocument((await categoryCatalogReference(database, householdId).get()).data(), householdId);
  const active = new Set(catalog.categories.filter(category => category.state === "active").map(category => category.categoryId));
  return new Set([...active, ...Object.entries(catalog.categoryAliases)
    .filter(([, categoryId]) => active.has(categoryId)).map(([alias]) => alias)]);
}
