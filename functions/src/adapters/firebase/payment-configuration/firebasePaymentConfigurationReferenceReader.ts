import type * as firestore from "firebase-admin/firestore";
import { categoryCatalogReference, readCategoryCatalogDocument } from "../categories/categoryCatalogDocument";

/** Category Catalog의 물리 경로를 Payment Configuration Application에서 격리합니다. */
export class FirebasePaymentConfigurationReferenceReader {
  constructor(private readonly database: firestore.Firestore) {}

  async isCategoryAvailable(
    householdId: string,
    categoryId: string,
  ): Promise<boolean> {
    const snapshot = await categoryCatalogReference(this.database, householdId).get();
    const catalog = readCategoryCatalogDocument(snapshot.data(), householdId);
    const stableId = catalog.categoryAliases[categoryId] ?? categoryId;
    return catalog.categories.some((category) => category.categoryId === stableId && category.state === "active");
  }
}
