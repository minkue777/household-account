import type * as firestore from "firebase-admin/firestore";
import { categoryLifecycleState, categoryReferenceId } from "./categoryReadMapping";

/** 신규 참조에 사용할 수 있는 category key만 공개하며 저장소 오류는 숨기지 않습니다. */
export async function readUsableCategoryIds(
  database: firestore.Firestore,
  householdId: string,
): Promise<ReadonlySet<string>> {
  const [canonical, legacy] = await Promise.all([
    database.collection("households").doc(householdId).collection("categories").get(),
    database.collection("categories").where("householdId", "==", householdId).get(),
  ]);
  const references = new Map<string, boolean>();
  // 같은 업무 key가 두 저장 형식에 있으면 canonical 상태가 항상 권위입니다.
  for (const snapshot of [...legacy.docs, ...canonical.docs]) {
    const data = snapshot.data();
    references.set(categoryReferenceId(snapshot.id, data), categoryLifecycleState(data) === "active");
  }
  return new Set([...references].filter(([, usable]) => usable).map(([categoryId]) => categoryId));
}
