"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveFcmToken = exports.onExpenseUpdated = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
/**
 * 지출이 수정되면 iOS PWA에 푸시 알림 전송
 * notifyPartner가 false → true로 변경될 때만 알림 전송
 */
exports.onExpenseUpdated = functions
    .region('asia-northeast3') // 서울 리전
    .firestore
    .document('expenses/{expenseId}')
    .onUpdate(async (change, context) => {
    var _a;
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
    // 알림 전송할 토큰 목록 가져오기
    const tokensSnapshot = await db.collection('fcmTokens').get();
    if (tokensSnapshot.empty) {
        console.log('등록된 FCM 토큰이 없습니다.');
        return null;
    }
    const tokens = [];
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
    // 금액 포맷팅
    const amount = ((_a = expense.amount) === null || _a === void 0 ? void 0 : _a.toLocaleString('ko-KR')) || '0';
    const merchant = expense.merchant || '알 수 없는 가맹점';
    // 푸시 알림 메시지
    const message = {
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
            const failedTokens = [];
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
    }
    catch (error) {
        console.error('푸시 알림 전송 실패:', error);
        return null;
    }
});
/**
 * FCM 토큰 저장 API
 */
exports.saveFcmToken = functions
    .region('asia-northeast3')
    .https.onCall(async (data, context) => {
    const { token, deviceInfo } = data;
    if (!token) {
        throw new functions.https.HttpsError('invalid-argument', 'FCM 토큰이 필요합니다.');
    }
    try {
        // 기존 토큰 확인
        const existingToken = await db.collection('fcmTokens')
            .where('token', '==', token)
            .get();
        if (!existingToken.empty) {
            // 이미 존재하면 업데이트
            const docId = existingToken.docs[0].id;
            await db.collection('fcmTokens').doc(docId).update({
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                deviceInfo: deviceInfo || null,
            });
            return { success: true, message: '토큰 업데이트 완료' };
        }
        // 새 토큰 저장
        await db.collection('fcmTokens').add({
            token: token,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            deviceInfo: deviceInfo || null,
        });
        return { success: true, message: '토큰 저장 완료' };
    }
    catch (error) {
        console.error('FCM 토큰 저장 실패:', error);
        throw new functions.https.HttpsError('internal', 'FCM 토큰 저장에 실패했습니다.');
    }
});
//# sourceMappingURL=index.js.map