import type * as firestore from "firebase-admin/firestore";
import { mergeActiveCategoryReferences } from "./categoryReadMapping";

/** 신규 참조에 사용할 수 있는 category key만 공개하며 저장소 오류는 숨기지 않습니다. */
export async function readUsableCategoryIds(
  database: firestore.Firestore,
  householdId: string,
): Promise<ReadonlySet<string>> {
  const [canonical, legacy] = await Promise.all([
    database.collection("households").doc(householdId).collection("categories").get(),
    database.collection("categories").where("householdId", "==", householdId).get(),
  ]);
  return new Set(mergeActiveCategoryReferences({ legacy: legacy.docs, canonical: canonical.docs })
    .map(({ categoryId }) => categoryId));
}
