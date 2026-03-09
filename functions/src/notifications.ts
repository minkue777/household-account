import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { db, messaging, REGION } from './config';
import { cleanupFailedTokens } from './helpers';

/**
 * "파트너에게" 버튼 클릭 시 상대방에게 푸시 알림 전송
 * notifyPartnerAt 타임스탬프가 변경될 때마다 알림 전송 (매번 가능)
 */
export const onExpenseUpdated = functions
  .region(REGION)
  .firestore
  .document('expenses/{expenseId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const expenseId = context.params.expenseId;

    // notifyPartnerAt이 변경된 경우에만 알림 전송 (타임스탬프 기반)
    const beforeTime = before.notifyPartnerAt?.toMillis?.() || before.notifyPartnerAt || 0;
    const afterTime = after.notifyPartnerAt?.toMillis?.() || after.notifyPartnerAt || 0;

    if (beforeTime === afterTime || afterTime === 0) {
      return null;
    }

    const expense = after;
    const householdId = expense.householdId;

    if (!householdId) {
      return null;
    }

    // 알림 보낸 사람 확인 (notifyPartnerBy 필드)
    const notifyBy = after.notifyPartnerBy;

    // 같은 householdId를 가진 토큰 중 notifyBy와 다른 deviceOwner만 가져오기
    const tokensSnapshot = await db.collection('fcmTokens')
      .where('householdId', '==', householdId)
      .get();

    if (tokensSnapshot.empty) {
      return null;
    }

    const tokens: string[] = [];
    tokensSnapshot.forEach(doc => {
      const data = doc.data();
      // notifyBy가 있으면 다른 사람에게만, 없으면 모두에게
      if (data.token && (!notifyBy || data.deviceOwner !== notifyBy)) {
        tokens.push(data.token);
      }
    });

    if (tokens.length === 0) {
      return null;
    }

    // 금액 포맷팅
    const amount = expense.amount?.toLocaleString('ko-KR') || '0';
    const merchant = expense.merchant || '알 수 없는 가맹점';

    const message: admin.messaging.MulticastMessage = {
      tokens: tokens,
      notification: {
        title: `💳 ${merchant}`,
        body: `${amount}원 - 탭해서 카테고리를 확인하세요`,
      },
      data: {
        expenseId: expenseId,
        merchant: merchant,
        amount: String(expense.amount || 0),
        date: expense.date || '',
        time: expense.time || '',
        category: expense.category || 'etc',
        type: 'new_expense',
      },
      webpush: {
        notification: {
          icon: 'https://household-account-app-demo-v1.vercel.app/icons/icon-192x192.png',
        },
        fcmOptions: {
          link: `/?edit=${expenseId}`,
        },
      },
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      await cleanupFailedTokens(tokens, response);
      return response;
    } catch (error) {
      console.error('FCM 전송 에러:', error);
      return null;
    }
  });

/**
 * 지출 생성 시 다른 멤버에게 알림 전송
 * createdBy가 있으면 해당 멤버를 제외한 나머지에게 푸시
 */
export const onExpenseCreated = functions
  .region(REGION)
  .firestore
  .document('expenses/{expenseId}')
  .onCreate(async (snapshot, context) => {
    const expense = snapshot.data();
    const expenseId = context.params.expenseId;

    const householdId = expense.householdId;
    if (!householdId) {
      return null;
    }

    const createdBy = expense.createdBy;
    if (!createdBy) {
      return null;
    }

    // 같은 household의 모든 토큰 조회, createdBy가 아닌 멤버에게만 전송
    const tokensSnapshot = await db.collection('fcmTokens')
      .where('householdId', '==', householdId)
      .get();

    if (tokensSnapshot.empty) {
      return null;
    }

    const tokens: string[] = [];
    tokensSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.token && data.deviceOwner !== createdBy) {
        tokens.push(data.token);
      }
    });

    if (tokens.length === 0) {
      return null;
    }

    // 금액 포맷팅
    const amount = expense.amount?.toLocaleString('ko-KR') || '0';
    const merchant = expense.merchant || '알 수 없는 가맹점';

    const message: admin.messaging.MulticastMessage = {
      tokens: tokens,
      notification: {
        title: `📱 ${merchant}`,
        body: `${amount}원 - ${createdBy}님이 등록한 지출이에요`,
      },
      data: {
        expenseId: expenseId,
        merchant: merchant,
        amount: String(expense.amount || 0),
        date: expense.date || '',
        time: expense.time || '',
        category: expense.category || 'etc',
        type: 'new_expense',
      },
      webpush: {
        notification: {
          icon: 'https://household-account-app-demo-v1.vercel.app/icons/icon-192x192.png',
        },
        fcmOptions: {
          link: `/?edit=${expenseId}`,
        },
      },
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      await cleanupFailedTokens(tokens, response);
      return response;
    } catch (error) {
      return null;
    }
  });

/**
 * FCM 토큰 저장 API
 */
export const saveFcmToken = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const { token, deviceInfo, householdId, deviceOwner } = data;

    if (!token) {
      throw new functions.https.HttpsError('invalid-argument', 'FCM 토큰이 필요합니다.');
    }

    if (!householdId) {
      throw new functions.https.HttpsError('invalid-argument', 'householdId가 필요합니다.');
    }

    try {
      // householdId_deviceOwner를 document ID로 사용 → 1인 1토큰 보장
      const docId = `${householdId}_${deviceOwner}`;
      await db.collection('fcmTokens').doc(docId).set({
        token: token,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        deviceInfo: deviceInfo || null,
        householdId: householdId,
        deviceOwner: deviceOwner || null,
      }, { merge: true });

      return { success: true, message: '토큰 저장 완료' };
    } catch (error) {
      throw new functions.https.HttpsError('internal', 'FCM 토큰 저장에 실패했습니다.');
    }
  });
