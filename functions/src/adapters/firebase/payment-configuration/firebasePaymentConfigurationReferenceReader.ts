import type * as firestore from "firebase-admin/firestore";

function isUsableCategory(
  snapshot: firestore.DocumentSnapshot,
  categoryId: string,
  householdId: string,
): boolean {
  if (!snapshot.exists) return false;
  const data = snapshot.data();
  if (data === undefined) return false;
  const storedHouseholdId =
    typeof data.householdId === "string" ? data.householdId : householdId;
  const storedCategoryId =
    typeof data.key === "string" && data.key.trim() !== ""
      ? data.key.trim()
      : snapshot.id;
  return (
    storedHouseholdId === householdId &&
    storedCategoryId === categoryId &&
    data.isActive !== false &&
    data.lifecycleState !== "archived" &&
    data.deletedAt === undefined
  );
}

/** Category Catalog의 물리 경로를 Payment Configuration Application에서 격리합니다. */
export class FirebasePaymentConfigurationReferenceReader {
  constructor(private readonly database: firestore.Firestore) {}

  async isCategoryAvailable(
    householdId: string,
    categoryId: string,
  ): Promise<boolean> {
    const [canonical, legacy] = await Promise.all([
      this.database
        .collection("households")
        .doc(householdId)
        .collection("categories")
        .get(),
      this.database
        .collection("categories")
        .where("householdId", "==", householdId)
        .get(),
    ]);
    return [...canonical.docs, ...legacy.docs].some((snapshot) =>
      isUsableCategory(snapshot, categoryId, householdId),
    );
  }
}
