import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

/** Household과 인가 projection은 같은 transaction에서 전환합니다. */
export function writeHouseholdClaimLifecycle(
  transaction: firestore.Transaction,
  claims: firestore.QuerySnapshot,
  lifecycleState: string,
): void {
  const householdLifecycleState = lifecycleState === "active" ? "active" : "deleted";
  for (const claim of claims.docs) {
    if (claim.data().householdLifecycleState === householdLifecycleState) continue;
    transaction.update(claim.ref, {
      householdLifecycleState,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}
