import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseLegacyMembershipStore } from '../../adapters/firebase/access/firebaseLegacyMembershipStore';
import { memberOwnerProfileId, sha256 } from '../../adapters/firebase/access/firebaseAccessPersistence';
import { createLegacyMembershipApplication } from '../../contexts/access/legacy-membership/application/legacyMembershipApplication';

export async function repairFirebaseLegacyMembership(db: Firestore, input: {
  operatorRef: string; householdId: string; principalUid: string; memberId: string; reason: string; idempotencyKey: string;
}) {
  if (!input.reason.trim()) throw new Error('RECOVERY_REASON_REQUIRED');
  const application = createLegacyMembershipApplication({
    store: new FirebaseLegacyMembershipStore(db, {
      principalUid: input.principalUid, householdKey: input.householdId, memberId: input.memberId,
      idempotencyKey: input.idempotencyKey, commandId: input.idempotencyKey,
      payloadFingerprint: sha256(JSON.stringify(['repair', input.householdId, input.principalUid, input.memberId, input.reason.trim()])),
      requestedAt: new Date().toISOString(),
      recoveryAudit: { operatorRef: input.operatorRef, reasonHash: sha256(input.reason.trim()) },
    }), profileIds: { profileIdForMember: memberOwnerProfileId },
  });
  return application.repairLegacyMembershipClaim({ principalRef: input.operatorRef, capabilities: ['admin.membership-claims.repair'] }, input);
}

/** 과거 논리 삭제에서 갱신되지 않은 projection만 명시적으로 교정합니다. 원래 binding은 변경하지 않습니다. */
export async function reconcileFirebaseHouseholdClaimLifecycle(db: Firestore, input: { householdId: string; operatorRef: string; reason: string; after?: string; pageSize?: number }) {
  if (!input.reason.trim()) throw new Error('RECOVERY_REASON_REQUIRED');
  const size = input.pageSize ?? 100;
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('INVALID_PAGE_SIZE');
  return db.runTransaction(async tx => {
    const household = await tx.get(db.collection('households').doc(input.householdId));
    if (!household.exists) throw new Error('HOUSEHOLD_NOT_FOUND');
    if (household.data()!.lifecycleState === 'purging' || household.data()!.lifecycleState === 'purged') throw new Error('HOUSEHOLD_PURGE_BARRIER');
    let query = db.collection('principalMembershipClaims').where('householdId', '==', input.householdId).orderBy('__name__').limit(size + 1);
    if (input.after) query = query.startAfter(input.after);
    const claims = (await tx.get(query)).docs;
    const state = household.data()!.lifecycleState;
    const expected = (state === undefined || state === 'active') && household.data()!.deletedAt == null ? 'active' : 'deleted';
    const page = claims.slice(0, size);
    const changed = page.filter(item => item.data().householdLifecycleState !== expected);
    for (const item of changed) tx.update(item.ref, { householdLifecycleState: expected, updatedAt: FieldValue.serverTimestamp() });
    if (changed.length) tx.create(db.collection('accessRecoveryAudit').doc(), {
      householdId: input.householdId, operatorRef: input.operatorRef, reasonHash: sha256(input.reason.trim()),
      changedCount: changed.length, lifecycleState: expected, recordedAt: FieldValue.serverTimestamp(),
    });
    return { changedCount: changed.length, nextCursor: claims.length > size ? page[page.length - 1].id : null };
  });
}
