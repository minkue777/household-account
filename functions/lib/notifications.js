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
exports.saveFcmToken = exports.onExpenseCreated = exports.onExpenseUpdated = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const config_1 = require("./config");
const helpers_1 = require("./helpers");
/**
 * "파트너에게" 버튼 클릭 시 상대방에게 푸시 알림 전송
 * notifyPartnerAt 타임스탬프가 변경될 때마다 알림 전송 (매번 가능)
 */
exports.onExpenseUpdated = functions
    .region(config_1.REGION)
    .firestore
    .document('expenses/{expenseId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c, _d, _e;
    const before = change.before.data();
    const after = change.after.data();
    const expenseId = context.params.expenseId;
    // notifyPartnerAt이 변경된 경우에만 알림 전송 (타임스탬프 기반)
    const beforeTime = ((_b = (_a = before.notifyPartnerAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || before.notifyPartnerAt || 0;
    const afterTime = ((_d = (_c = after.notifyPartnerAt) === null || _c === void 0 ? void 0 : _c.toMillis) === null || _d === void 0 ? void 0 : _d.call(_c)) || after.notifyPartnerAt || 0;
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
    const tokensSnapshot = await config_1.db.collection('fcmTokens')
        .where('householdId', '==', householdId)
        .get();
    if (tokensSnapshot.empty) {
        return null;
    }
    const tokens = [];
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
    const amount = ((_e = expense.amount) === null || _e === void 0 ? void 0 : _e.toLocaleString('ko-KR')) || '0';
    const merchant = expense.merchant || '알 수 없는 가맹점';
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
                icon: 'https://household-account-app-demo-v1.vercel.app/icons/icon-192x192.png',
            },
            fcmOptions: {
                link: `/?edit=${expenseId}`,
            },
        },
    };
    try {
        const response = await config_1.messaging.sendEachForMulticast(message);
        await (0, helpers_1.cleanupFailedTokens)(tokens, response);
        return response;
    }
    catch (error) {
        console.error('FCM 전송 에러:', error);
        return null;
    }
});
/**
 * 지출 생성 시 다른 멤버에게 알림 전송
 * createdBy가 있으면 해당 멤버를 제외한 나머지에게 푸시
 */
exports.onExpenseCreated = functions
    .region(config_1.REGION)
    .firestore
    .document('expenses/{expenseId}')
    .onCreate(async (snapshot, context) => {
    var _a;
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
    const tokensSnapshot = await config_1.db.collection('fcmTokens')
        .where('householdId', '==', householdId)
        .get();
    if (tokensSnapshot.empty) {
        return null;
    }
    const tokens = [];
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
    const amount = ((_a = expense.amount) === null || _a === void 0 ? void 0 : _a.toLocaleString('ko-KR')) || '0';
    const merchant = expense.merchant || '알 수 없는 가맹점';
    const message = {
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
        const response = await config_1.messaging.sendEachForMulticast(message);
        await (0, helpers_1.cleanupFailedTokens)(tokens, response);
        return response;
    }
    catch (error) {
        return null;
    }
});
/**
 * FCM 토큰 저장 API
 */
exports.saveFcmToken = functions
    .region(config_1.REGION)
    .https.onCall(async (data, context) => {
    const { token, deviceInfo, householdId, deviceOwner } = data;
    if (!token) {
        throw new functions.https.HttpsError('invalid-argument', 'FCM 토큰이 필요합니다.');
    }
    if (!householdId) {
        throw new functions.https.HttpsError('invalid-argument', 'householdId가 필요합니다.');
    }
    try {
        // 기존 토큰 확인
        const existingToken = await config_1.db.collection('fcmTokens')
            .where('token', '==', token)
            .get();
        if (!existingToken.empty) {
            // 이미 존재하면 업데이트 (householdId도 업데이트 - 계정 변경 대응)
            const docId = existingToken.docs[0].id;
            await config_1.db.collection('fcmTokens').doc(docId).update({
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                deviceInfo: deviceInfo || null,
                householdId: householdId,
                deviceOwner: deviceOwner || null,
            });
            return { success: true, message: '토큰 업데이트 완료' };
        }
        // 새 토큰 저장
        await config_1.db.collection('fcmTokens').add({
            token: token,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            deviceInfo: deviceInfo || null,
            householdId: householdId,
            deviceOwner: deviceOwner || null,
        });
        return { success: true, message: '토큰 저장 완료' };
    }
    catch (error) {
        throw new functions.https.HttpsError('internal', 'FCM 토큰 저장에 실패했습니다.');
    }
});
//# sourceMappingURL=notifications.js.map