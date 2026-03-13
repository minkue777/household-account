import { doc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { MemberStorage } from './storage/memberStorage';

const COLLECTION_NAME = 'expenses';

/**
 * 파트너에게 알림 전송 요청
 */
export async function notifyPartner(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  const deviceOwner = MemberStorage.getMemberName();

  await updateDoc(docRef, {
    notifyPartnerAt: Timestamp.now(),
    notifyPartnerBy: deviceOwner || null,
  });
}
