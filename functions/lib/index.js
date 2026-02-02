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
exports.addExpenseFromMessage = exports.saveFcmToken = exports.onExpenseCreated = exports.onExpenseUpdated = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
// iOS 단축어용 API 토큰 (환경변수로 관리 권장)
const API_TOKEN = 'household-account-ios-shortcut-2024';
/**
 * "또니에게" 버튼 클릭 시 상대방에게 푸시 알림 전송
 * notifyPartnerAt 타임스탬프가 변경될 때마다 알림 전송 (매번 가능)
 */
exports.onExpenseUpdated = functions
    .region('asia-northeast3') // 서울 리전
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
    const tokensSnapshot = await db.collection('fcmTokens')
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
                icon: 'https://household-account-app-demo-v1.vercel.app/icons/icon-192x192.png',
            },
            fcmOptions: {
                link: `/?edit=${expenseId}`,
            },
        },
    };
    try {
        const response = await messaging.sendEachForMulticast(message);
        // 실패한 토큰 정리
        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(tokens[idx]);
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
        return null;
    }
});
/**
 * 또니(아이폰)가 지출 생성하면 망고(안드로이드)에게 알림
 * - iOS 단축어로 등록
 * - 아이폰 웹앱에서 수동 등록
 * 망고가 등록한 건 "또니에게" 버튼으로만 알림 전송
 */
exports.onExpenseCreated = functions
    .region('asia-northeast3')
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
    // 또니가 등록한 경우에만 알림
    // iOS 단축어: source가 'ios-shortcut'
    // 아이폰 웹앱: createdBy가 '또니'
    const isFromToni = expense.source === 'ios-shortcut' || expense.createdBy === '또니';
    if (!isFromToni) {
        return null; // 망고가 등록한 건 알림 안 보냄
    }
    // 망고(안드로이드) 기기의 토큰만 가져오기
    const tokensSnapshot = await db.collection('fcmTokens')
        .where('householdId', '==', householdId)
        .where('deviceOwner', '==', '망고')
        .get();
    if (tokensSnapshot.empty) {
        return null;
    }
    const tokens = [];
    tokensSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.token) {
            tokens.push(data.token);
        }
    });
    if (tokens.length === 0) {
        return null;
    }
    // 금액 포맷팅
    const amount = ((_a = expense.amount) === null || _a === void 0 ? void 0 : _a.toLocaleString('ko-KR')) || '0';
    const merchant = expense.merchant || '알 수 없는 가맹점';
    // 푸시 알림 메시지
    const message = {
        tokens: tokens,
        notification: {
            title: `📱 ${merchant}`,
            body: `${amount}원 - 또니가 등록한 지출이에요`,
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
        // 실패한 토큰 정리
        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(tokens[idx]);
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
        return null;
    }
});
/**
 * FCM 토큰 저장 API
 */
exports.saveFcmToken = functions
    .region('asia-northeast3')
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
                deviceOwner: deviceOwner || null,
            });
            return { success: true, message: '토큰 업데이트 완료' };
        }
        // 새 토큰 저장
        await db.collection('fcmTokens').add({
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
function parseCardMessage(message) {
    try {
        // 삼성카드 포맷 파싱
        // 금액 찾기: "9,990원" 또는 "250,000원"
        const amountMatch = message.match(/([0-9,]+)원\s*(일시불|할부)/);
        if (!amountMatch) {
            return null;
        }
        const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
        // 날짜/시간/가맹점 찾기: "01/29 16:49 롯데슈퍼동탄디에"
        const dateTimeMatch = message.match(/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s+(.+?)(?:\s*누적|\n|$)/);
        if (!dateTimeMatch) {
            return null;
        }
        const month = dateTimeMatch[1];
        const day = dateTimeMatch[2];
        const hour = dateTimeMatch[3];
        const minute = dateTimeMatch[4];
        const merchant = dateTimeMatch[5].trim().replace(/\s*누적.*$/, '');
        // 현재 연도 사용 (1월인데 12월 결제면 작년으로 처리)
        const now = new Date();
        let year = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        if (parseInt(month) > currentMonth + 1) {
            year -= 1; // 작년 결제
        }
        const date = `${year}-${month}-${day}`;
        const time = `${hour}:${minute}`;
        // 카드 이름 찾기: "삼성1876승인"
        const cardMatch = message.match(/(삼성|신한|국민|현대|롯데|하나|우리|BC|NH)([\d]*)승인/);
        const cardName = cardMatch ? cardMatch[1] + (cardMatch[2] || '') : '삼성카드';
        const cardLastFour = cardMatch && cardMatch[2] ? cardMatch[2] : undefined;
        return {
            amount,
            merchant,
            date,
            time,
            cardName,
            cardLastFour,
        };
    }
    catch (error) {
        return null;
    }
}
/**
 * iOS 단축어에서 호출하는 API
 * SMS/카카오톡 메시지를 받아서 파싱 후 Firestore에 저장
 */
exports.addExpenseFromMessage = functions
    .region('asia-northeast3')
    .https.onRequest(async (req, res) => {
    // CORS 헤더
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' });
        return;
    }
    try {
        const { message, token, householdId } = req.body;
        // 토큰 검증
        if (token !== API_TOKEN) {
            res.status(401).json({ success: false, error: '인증 실패' });
            return;
        }
        if (!message) {
            res.status(400).json({ success: false, error: '메시지가 필요합니다' });
            return;
        }
        if (!householdId) {
            res.status(400).json({ success: false, error: 'householdId가 필요합니다' });
            return;
        }
        // 메시지 파싱
        const parsed = parseCardMessage(message);
        if (!parsed) {
            res.status(400).json({ success: false, error: '메시지 파싱 실패', rawMessage: message });
            return;
        }
        // 중복 체크 (같은 날짜, 시간, 금액, 가맹점)
        const duplicateCheck = await db.collection('expenses')
            .where('householdId', '==', householdId)
            .where('date', '==', parsed.date)
            .where('time', '==', parsed.time)
            .where('amount', '==', parsed.amount)
            .where('merchant', '==', parsed.merchant)
            .get();
        if (!duplicateCheck.empty) {
            res.status(200).json({ success: true, message: '이미 등록된 지출입니다', duplicate: true });
            return;
        }
        // Firestore에 저장
        const expenseData = {
            amount: parsed.amount,
            merchant: parsed.merchant,
            date: parsed.date,
            time: parsed.time,
            category: 'etc', // 기본 카테고리
            memo: '',
            householdId: householdId,
            source: 'ios-shortcut',
            notifyPartner: false, // "또니에게" 버튼으로 알림 보낼 수 있도록
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        // 카드 끝 4자리가 있으면 추가
        if (parsed.cardLastFour) {
            expenseData.cardLastFour = parsed.cardLastFour;
        }
        const docRef = await db.collection('expenses').add(expenseData);
        res.status(200).json({
            success: true,
            message: '지출 등록 완료',
            expenseId: docRef.id,
            parsed: parsed,
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: '서버 에러' });
    }
});
//# sourceMappingURL=index.js.map