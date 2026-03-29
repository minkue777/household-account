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
exports.addExpenseFromMessage = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const config_1 = require("./config");
function normalizeShortcutValue(value) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map(normalizeShortcutValue).filter(Boolean).join('\n').trim();
    }
    if (value && typeof value === 'object') {
        const record = value;
        const preferredKeys = ['string', 'text', 'value', 'plainText', 'PlainText'];
        for (const key of preferredKeys) {
            const candidate = record[key];
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate.trim();
            }
        }
        try {
            return JSON.stringify(value);
        }
        catch (_error) {
            return '';
        }
    }
    return '';
}
/**
 * 카드사 메시지 파싱
 * 삼성카드 포맷:
 * 삼성1876승인 이*선
 * 9,990원 일시불
 * 01/29 16:49 롯데슈퍼동탄디에
 * 누적541,665원
 */
function parseCardMessage(message) {
    try {
        const normalizedMessage = message.replace(/\r/g, '').trim();
        const amountMatch = normalizedMessage.match(/([0-9,]+)원(?:\s*(일시불|할부|체크))?/);
        if (!amountMatch) {
            return null;
        }
        const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
        const dateTimeMatch = normalizedMessage.match(/(\d{1,2})\/(\d{1,2})\s+(\d{2}):(\d{2})\s+(.+?)(?:\s*누적|\n|$)/);
        if (!dateTimeMatch) {
            return null;
        }
        const month = dateTimeMatch[1];
        const day = dateTimeMatch[2];
        const hour = dateTimeMatch[3];
        const minute = dateTimeMatch[4];
        const merchant = dateTimeMatch[5].trim().replace(/\s*누적.*$/, '');
        const now = new Date();
        let year = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        if (parseInt(month) > currentMonth + 1) {
            year -= 1;
        }
        const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        const time = `${hour}:${minute}`;
        const cardMatch = normalizedMessage.match(/(삼성|신한|국민|현대|롯데|하나|우리|BC|NH)([\d]*)승인/);
        const cardName = cardMatch ? cardMatch[1] + (cardMatch[2] || '') : '삼성카드';
        const cardLastFour = cardMatch && cardMatch[2] ? cardMatch[2] : undefined;
        return { amount, merchant, date, time, cardName, cardLastFour };
    }
    catch (error) {
        return null;
    }
}
async function getDefaultCategoryKey(householdId) {
    var _a;
    const householdSnapshot = await config_1.db.collection('households').doc(householdId).get();
    const defaultCategoryKey = (_a = householdSnapshot.data()) === null || _a === void 0 ? void 0 : _a.defaultCategoryKey;
    return typeof defaultCategoryKey === 'string' && defaultCategoryKey.trim()
        ? defaultCategoryKey.trim()
        : 'etc';
}
/**
 * iOS 단축어에서 호출하는 API
 * SMS/카카오톡 메시지를 받아서 파싱 후 Firestore에 저장
 */
exports.addExpenseFromMessage = functions
    .region(config_1.REGION)
    .https.onRequest(async (req, res) => {
    var _a, _b, _c;
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
        const rawMessage = (_a = req.body) === null || _a === void 0 ? void 0 : _a.message;
        const rawToken = (_b = req.body) === null || _b === void 0 ? void 0 : _b.token;
        const rawHouseholdId = (_c = req.body) === null || _c === void 0 ? void 0 : _c.householdId;
        const message = normalizeShortcutValue(rawMessage);
        const token = normalizeShortcutValue(rawToken);
        const householdId = normalizeShortcutValue(rawHouseholdId);
        const tokenMatched = token === config_1.API_TOKEN;
        if (!tokenMatched) {
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
        const parsed = parseCardMessage(message);
        if (!parsed) {
            res.status(400).json({
                success: false,
                error: '메시지 파싱 실패',
                rawMessage: message,
            });
            return;
        }
        // 중복 체크
        const duplicateCheck = await config_1.db.collection('expenses')
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
        const defaultCategoryKey = await getDefaultCategoryKey(householdId);
        const expenseData = {
            amount: parsed.amount,
            merchant: parsed.merchant,
            date: parsed.date,
            time: parsed.time,
            category: defaultCategoryKey,
            memo: '',
            householdId: householdId,
            source: 'ios-shortcut',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (parsed.cardLastFour) {
            expenseData.cardLastFour = parsed.cardLastFour;
            expenseData.cardType = parsed.cardLastFour === '1876' ? 'sam' : 'main';
        }
        const docRef = await config_1.db.collection('expenses').add(expenseData);
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
//# sourceMappingURL=expenses.js.map