import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { db, messaging, REGION, API_TOKEN } from './config';
import { cleanupFailedTokens } from './helpers';

interface ParsedExpense {
  amount: number;
  merchant: string;
  date: string;
  time: string;
  cardName: string;
  cardLabel: string;
  cardLastFour?: string;
}

function normalizeShortcutValue(value: unknown): string {
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
    const record = value as Record<string, unknown>;
    const preferredKeys = ['string', 'text', 'value', 'plainText', 'PlainText'];

    for (const key of preferredKeys) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    try {
      return JSON.stringify(value);
    } catch (_error) {
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
function parseCardMessage(message: string): ParsedExpense | null {
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
    const cardLabel = normalizeCardLabel(cardMatch ? cardMatch[1] : '삼성');
    const cardName = cardMatch ? cardMatch[1] + (cardMatch[2] || '') : '삼성카드';
    const cardLastFour = cardMatch && cardMatch[2] ? cardMatch[2] : undefined;

    return { amount, merchant, date, time, cardName, cardLabel, cardLastFour };
  } catch (error) {
    return null;
  }
}

function normalizeCardLabel(value: string | undefined): string {
  const normalized = (value || '').trim().toLowerCase();

  switch (normalized) {
    case 'bc':
      return '비씨';
    case 'nh':
      return '농협';
    default:
      return (value || '').trim();
  }
}

function normalizeCardToken(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/＊/g, 'x')
    .replace(/\*/g, 'x')
    .replace(/[^0-9x]/g, '')
    .slice(-4);

  return normalized || null;
}

function matchesCardToken(firstValue: unknown, secondValue: unknown): boolean {
  const firstToken = normalizeCardToken(firstValue);
  const secondToken = normalizeCardToken(secondValue);

  if (!firstToken || !secondToken || firstToken.length !== secondToken.length) {
    return false;
  }

  return firstToken.split('').every((char, index) => {
    const otherChar = secondToken[index];
    return char === otherChar || char === 'x' || otherChar === 'x';
  });
}

async function resolveShortcutOwner(
  householdId: string,
  parsed: ParsedExpense,
  requestedOwner: string
): Promise<string | null> {
  const normalizedRequestedOwner = requestedOwner.trim();
  const tokenSnapshot = await db.collection('fcmTokens')
    .where('householdId', '==', householdId)
    .get();
  const tokenOwners = new Set<string>();

  tokenSnapshot.forEach(doc => {
    const owner = doc.data().deviceOwner;
    if (typeof owner === 'string' && owner.trim()) {
      tokenOwners.add(owner.trim());
    }
  });

  if (normalizedRequestedOwner && tokenOwners.has(normalizedRequestedOwner)) {
    return normalizedRequestedOwner;
  }

  const registeredCardsSnapshot = await db.collection('registered_cards')
    .where('householdId', '==', householdId)
    .get();

  const labelMatchedCards: Array<{ owner: string; cardLastFour: unknown }> = [];
  registeredCardsSnapshot.forEach(doc => {
    const card = doc.data();
    const owner = typeof card.owner === 'string' ? card.owner.trim() : '';
    const cardLabel = normalizeCardLabel(typeof card.cardLabel === 'string' ? card.cardLabel : '');

    if (owner && cardLabel === parsed.cardLabel) {
      labelMatchedCards.push({
        owner,
        cardLastFour: card.cardLastFour,
      });
    }
  });

  const exactCard = labelMatchedCards.find(card =>
    matchesCardToken(card.cardLastFour, parsed.cardLastFour)
  );
  if (exactCard) {
    return exactCard.owner;
  }

  const uniqueOwners = Array.from(new Set(labelMatchedCards.map(card => card.owner)));
  if (uniqueOwners.length === 1) {
    return uniqueOwners[0];
  }

  return normalizedRequestedOwner || null;
}

async function sendShortcutExpenseNotification(
  householdId: string,
  targetOwner: string | null,
  expenseId: string,
  parsed: ParsedExpense,
  duplicate: boolean
): Promise<boolean> {
  if (!targetOwner) {
    return false;
  }

  const tokensSnapshot = await db.collection('fcmTokens')
    .where('householdId', '==', householdId)
    .get();
  const tokens: string[] = [];

  tokensSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.token && data.deviceOwner === targetOwner) {
      tokens.push(data.token);
    }
  });

  if (tokens.length === 0) {
    return false;
  }

  const amount = parsed.amount.toLocaleString('ko-KR');
  const message: admin.messaging.MulticastMessage = {
    tokens,
    notification: {
      title: `📱 ${parsed.merchant}`,
      body: duplicate
        ? `${amount}원 - 이미 등록된 지출이에요`
        : `${amount}원 - 지출이 등록됐어요`,
    },
    data: {
      expenseId,
      merchant: parsed.merchant,
      amount: String(parsed.amount),
      date: parsed.date,
      time: parsed.time,
      category: 'etc',
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

  const response = await messaging.sendEachForMulticast(message);
  await cleanupFailedTokens(tokens, response);

  return response.successCount > 0;
}

async function getDefaultCategoryKey(householdId: string): Promise<string> {
  const householdSnapshot = await db.collection('households').doc(householdId).get();
  const defaultCategoryKey = householdSnapshot.data()?.defaultCategoryKey;

  return typeof defaultCategoryKey === 'string' && defaultCategoryKey.trim()
    ? defaultCategoryKey.trim()
    : 'etc';
}

/**
 * iOS 단축어에서 호출하는 API
 * SMS/카카오톡 메시지를 받아서 파싱 후 Firestore에 저장
 */
export const addExpenseFromMessage = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
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
      const rawMessage = req.body?.message;
      const rawToken = req.body?.token;
      const rawHouseholdId = req.body?.householdId;
      const rawCreatedBy = req.body?.createdBy ?? req.body?.memberName ?? req.body?.deviceOwner ?? req.body?.owner;

      const message = normalizeShortcutValue(rawMessage);
      const token = normalizeShortcutValue(rawToken);
      const householdId = normalizeShortcutValue(rawHouseholdId);
      const createdBy = normalizeShortcutValue(rawCreatedBy);
      const tokenMatched = token === API_TOKEN;

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

      const shortcutOwner = await resolveShortcutOwner(householdId, parsed, createdBy);

      // 중복 체크
      const duplicateCheck = await db.collection('expenses')
        .where('householdId', '==', householdId)
        .where('date', '==', parsed.date)
        .where('time', '==', parsed.time)
        .where('amount', '==', parsed.amount)
        .where('merchant', '==', parsed.merchant)
        .get();

      if (!duplicateCheck.empty) {
        const duplicateDoc = duplicateCheck.docs[0];
        const notificationSent = await sendShortcutExpenseNotification(
          householdId,
          shortcutOwner,
          duplicateDoc.id,
          parsed,
          true
        );

        res.status(200).json({
          success: true,
          message: '이미 등록된 지출입니다',
          duplicate: true,
          notificationSent,
          targetOwner: shortcutOwner,
        });
        return;
      }

      const defaultCategoryKey = await getDefaultCategoryKey(householdId);

      const expenseData: Record<string, unknown> = {
        amount: parsed.amount,
        merchant: parsed.merchant,
        date: parsed.date,
        time: parsed.time,
        transactionType: 'expense',
        category: defaultCategoryKey,
        memo: '',
        householdId: householdId,
        source: 'ios-shortcut',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (shortcutOwner) {
        expenseData.createdBy = shortcutOwner;
      }

      if (parsed.cardLastFour) {
        expenseData.cardLastFour = parsed.cardLastFour;
        expenseData.cardType = parsed.cardLastFour === '1876' ? 'sam' : 'main';
      }

      const docRef = await db.collection('expenses').add(expenseData);

      res.status(200).json({
        success: true,
        message: '지출 등록 완료',
        expenseId: docRef.id,
        parsed: parsed,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: '서버 에러' });
    }
  });
