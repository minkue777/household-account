import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

/**
 * 지출이 수정되면 iOS PWA에 푸시 알림 전송
 * notifyPartner가 false → true로 변경될 때만 알림 전송
 */
export const onExpenseUpdated = functions
  .region('asia-northeast3') // 서울 리전
  .firestore
  .document('expenses/{expenseId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const expenseId = context.params.expenseId;

    // notifyPartner가 false → true로 변경된 경우에만 알림 전송
    const wasNotifying = before.notifyPartner === true;
    const isNotifying = after.notifyPartner === true;

    if (wasNotifying || !isNotifying) {
      console.log('알림 전송 스킵 (notifyPartner 변경 없음 또는 false)');
      return null;
    }

    console.log('알림 전송 시작 (notifyPartner: true로 변경됨)');
    const expense = after;
    const householdId = expense.householdId;

    if (!householdId) {
      console.log('householdId가 없어서 알림 전송 스킵');
      return null;
    }

    // 같은 householdId를 가진 토큰만 가져오기
    const tokensSnapshot = await db.collection('fcmTokens')
      .where('householdId', '==', householdId)
      .get();

    if (tokensSnapshot.empty) {
      console.log(`householdId(${householdId})에 해당하는 FCM 토큰이 없습니다.`);
      return null;
    }

    const tokens: string[] = [];
    tokensSnapshot.forEach(doc => {
      const token = doc.data().token;
      if (token) {
        tokens.push(token);
      }
    });

    if (tokens.length === 0) {
      console.log('유효한 FCM 토큰이 없습니다.');
      return null;
    }

    console.log(`householdId(${householdId})에 ${tokens.length}개의 토큰으로 알림 전송`);

    // 금액 포맷팅
    const amount = expense.amount?.toLocaleString('ko-KR') || '0';
    const merchant = expense.merchant || '알 수 없는 가맹점';

    // 푸시 알림 메시지 (data-only: 서비스 워커에서만 알림 표시)
    const message: admin.messaging.MulticastMessage = {
      tokens: tokens,
      // notification 필드 제거 - 있으면 FCM SDK가 자동 알림 + 서비스워커 알림으로 중복 발생
      data: {
        title: `💳 ${merchant}`,
        body: `${amount}원 - 탭해서 카테고리를 확인하세요`,
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
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
          vibrate: [200, 100, 200],
          requireInteraction: true,
          actions: [
            {
              action: 'edit',
              title: '수정하기',
            },
            {
              action: 'dismiss',
              title: '닫기',
            },
          ],
        },
        fcmOptions: {
          link: `/?edit=${expenseId}`,
        },
      },
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      console.log(`푸시 알림 전송 완료: 성공 ${response.successCount}, 실패 ${response.failureCount}`);

      // 실패한 토큰 정리
      if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(tokens[idx]);
            console.error(`토큰 전송 실패: ${tokens[idx]}`, resp.error);
          }
        });

        // 실패한 토큰 삭제
        const deletePromises = failedTokens.map(async (token) => {
          const tokenQuery = await db.collection('fcmTokens')
            .where('token', '==', token)
            .get();
          tokenQuery.forEach(doc => doc.ref.delete());
        });
        await Promise.all(deletePromises);
      }

      return response;
    } catch (error) {
      console.error('푸시 알림 전송 실패:', error);
      return null;
    }
  });

/**
 * FCM 토큰 저장 API
 */
export const saveFcmToken = functions
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    const { token, deviceInfo, householdId } = data;

    if (!token) {
      throw new functions.https.HttpsError('invalid-argument', 'FCM 토큰이 필요합니다.');
    }

    if (!householdId) {
      throw new functions.https.HttpsError('invalid-argument', 'householdId가 필요합니다.');
    }

    try {
      // 기존 토큰 확인
      const existingToken = await db.collection('fcmTokens')
        .where('token', '==', token)
        .get();

      if (!existingToken.empty) {
        // 이미 존재하면 업데이트 (householdId도 업데이트 - 계정 변경 대응)
        const docId = existingToken.docs[0].id;
        await db.collection('fcmTokens').doc(docId).update({
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          deviceInfo: deviceInfo || null,
          householdId: householdId,
        });
        console.log(`토큰 업데이트 완료 (householdId: ${householdId})`);
        return { success: true, message: '토큰 업데이트 완료' };
      }

      // 새 토큰 저장
      await db.collection('fcmTokens').add({
        token: token,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        deviceInfo: deviceInfo || null,
        householdId: householdId,
      });

      console.log(`새 토큰 저장 완료 (householdId: ${householdId})`);
      return { success: true, message: '토큰 저장 완료' };
    } catch (error) {
      console.error('FCM 토큰 저장 실패:', error);
      throw new functions.https.HttpsError('internal', 'FCM 토큰 저장에 실패했습니다.');
    }
  });
