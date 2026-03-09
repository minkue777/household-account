/**
 * 정산 서비스
 * - 정산 요청, 정산 완료, 정산 취소
 * - 파트너 알림 전송
 */
import {
  updateDoc,
  doc,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { MemberStorage } from './storage/memberStorage';

const COLLECTION_NAME = 'expenses';

/**
 * 정산 필요 여부 판단
 * - 삼성카드(sam) + 생활비(food, childcare, living) → 필요
 * - 삼성카드(sam) + 여행비(custom_1769210277541) → 필요
 * - 비상금(etc) → 필요 (카드 종류 무관, local_currency 제외)
 * - 그 외 → 불필요
 */
export function checkSettleable(cardType: string | undefined, category: string): boolean {
  const card = cardType?.toLowerCase();

  // 삼성카드 정산 대상 카테고리
  const samSettleableCategories = [
    'food',                    // 식비
    'childcare',               // 육아비
    'living',                  // 생활비
    'custom_1769210277541',    // 여행
  ];

  // local_currency는 정산 불필요
  if (card === 'local_currency') {
    return false;
  }
  // 비상금(etc)은 카드 종류 상관없이 정산 필요 (local_currency 제외)
  if (category === 'etc') {
    return true;
  }
  // 삼성카드(sam)는 지정된 카테고리만 정산 필요
  if (card === 'sam') {
    return samSettleableCategories.includes(category);
  }
  // 그 외 (국민카드 main/family 등)는 정산 불필요
  return false;
}

/**
 * 파트너에게 전송 (notifyPartner 플래그 설정)
 */
export async function notifyPartner(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  const deviceOwner = MemberStorage.getMemberName();
  await updateDoc(docRef, {
    notifyPartnerAt: Timestamp.now(),
    notifyPartnerBy: deviceOwner || null,
  });
}

/**
 * 정산 요청 (정산하기 버튼 클릭 시 호출)
 * pendingSettlement: true로 표시하여 빠른 검색 가능
 */
export async function requestSettlement(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, {
    settlementRequestedAt: new Date().toISOString(),
    pendingSettlement: true
  });
}

/**
 * 정산 완료 처리
 */
export async function settleExpense(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  const deviceOwner = MemberStorage.getMemberName();
  await updateDoc(docRef, {
    settled: true,
    settledAt: new Date().toISOString(),
    settledBy: deviceOwner || null,
    pendingSettlement: false,
  });
}

/**
 * 정산 취소 (정산 완료 상태를 되돌림)
 */
export async function unsettleExpense(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, {
    settled: false,
    settledAt: null,
    settledBy: null,
    pendingSettlement: true,
  });
}
