import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { db, REGION } from './config';

export const renameHouseholdMember = functions
  .region(REGION)
  .https.onCall(async (data) => {
    const householdId = typeof data?.householdId === 'string' ? data.householdId.trim() : '';
    const memberId = typeof data?.memberId === 'string' ? data.memberId.trim() : '';
    const newName = typeof data?.newName === 'string' ? data.newName.trim() : '';

    if (!householdId || !memberId || !newName) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'householdId, memberId, newName이 필요합니다.'
      );
    }

    const householdRef = db.collection('households').doc(householdId);
    const householdSnap = await householdRef.get();

    if (!householdSnap.exists) {
      throw new functions.https.HttpsError('not-found', '가계를 찾을 수 없습니다.');
    }

    const householdData = householdSnap.data() || {};
    const members = Array.isArray(householdData.members) ? householdData.members : [];
    const memberIndex = members.findIndex((member: { id?: string }) => member?.id === memberId);

    if (memberIndex === -1) {
      throw new functions.https.HttpsError('not-found', '멤버를 찾을 수 없습니다.');
    }

    const oldName = typeof members[memberIndex]?.name === 'string' ? members[memberIndex].name : '';
    if (!oldName) {
      throw new functions.https.HttpsError('failed-precondition', '기존 멤버 이름이 비어 있습니다.');
    }

    const isDuplicateName = members.some(
      (member: { id?: string; name?: string }) =>
        member?.id !== memberId && typeof member?.name === 'string' && member.name.trim() === newName
    );

    if (isDuplicateName) {
      throw new functions.https.HttpsError('already-exists', '이미 같은 이름의 멤버가 있습니다.');
    }

    if (oldName === newName) {
      return {
        success: true,
        oldName,
        newName,
        updatedAssets: 0,
      };
    }

    const updatedMembers = members.map((member: { id?: string; name?: string }) =>
      member?.id === memberId ? { ...member, name: newName } : member
    );

    const batch = db.batch();
    batch.update(householdRef, { members: updatedMembers });

    const assetsSnapshot = await db
      .collection('assets')
      .where('householdId', '==', householdId)
      .get();

    const assetsToUpdate = assetsSnapshot.docs.filter((docSnap) => docSnap.data().owner === oldName);
    assetsToUpdate.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        owner: newName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    const oldTokenRef = db.collection('fcmTokens').doc(`${householdId}_${oldName}`);
    const oldTokenSnap = await oldTokenRef.get();

    if (oldTokenSnap.exists) {
      const newTokenRef = db.collection('fcmTokens').doc(`${householdId}_${newName}`);
      batch.set(
        newTokenRef,
        {
          ...oldTokenSnap.data(),
          deviceOwner: newName,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      batch.delete(oldTokenRef);
    }

    await batch.commit();

    return {
      success: true,
      oldName,
      newName,
      updatedAssets: assetsToUpdate.length,
    };
  });
