import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  Timestamp,
  getDocs,
  runTransaction,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import { Expense, MergedExpenseInfo, TransactionType } from '@/types/expense';
import { getStoredHouseholdKey } from './householdService';
import { MemberStorage } from './storage/memberStorage';
import { getMonthlySplitDate } from '@/lib/utils/monthlySplitDate';

const COLLECTION_NAME = 'expenses';
const DEFAULT_TRANSACTION_TYPE: TransactionType = 'expense';

interface AddExpenseOptions {
  notifyOnCreate?: boolean;
}

interface ExpenseQueryOptions {
  transactionType?: TransactionType;
}

interface ExactCardSearchKeyword {
  label: string;
  token: string;
}

const CARD_LABEL_ALIAS_GROUPS = [
  ['국민', '국민카드', 'KB', 'KB국민', 'KB국민카드'],
  ['삼성', '삼성카드'],
  ['농협', '농협카드', 'NH', 'NH농협'],
  ['롯데', '롯데카드'],
  ['비씨', '비씨카드', 'BC', 'BC카드'],
  ['현대', '현대카드'],
  ['우리', '우리카드'],
  ['신한', '신한카드'],
  ['하나', '하나카드'],
  ['네이버페이', '네이버'],
  ['카카오페이', '카카오'],
  ['토스', '토스뱅크'],
  ['대전사랑카드', '대전사랑', '대전지역화폐'],
  ['경기지역화폐', '경기지역', '경기화폐'],
  ['세종지역화폐', '여민전', '세종화폐'],
  ['온누리상품권', '온누리'],
] as const;

const CARD_TYPE_SEARCH_TERMS: Record<string, string[]> = {
  main: ['main', '본인', '본인카드'],
  family: ['family', '가족', '가족카드'],
  manual: ['manual', '수동'],
  local_currency: ['local_currency', '지역', '지역화폐'],
};

const EXACT_CARD_KEYWORD_PATTERN = /^(.+?)\s*\(\s*([0-9*xX＊]{4})\s*\)$/;

/**
 * 현재 가구 키 가져오기
 */
function getHouseholdId(): string {
  const key = getStoredHouseholdKey();
  if (!key) {
    throw new Error('가구 키가 없습니다. 다시 로그인해주세요.');
  }
  return key;
}

/**
 * Firestore 문서를 Expense 객체로 변환 (DRY 원칙)
 */
function mapDocToExpense(docSnap: QueryDocumentSnapshot<DocumentData>): Expense {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    date: data.date,
    time: data.time,
    merchant: data.merchant,
    amount: data.amount,
    transactionType: (data.transactionType || DEFAULT_TRANSACTION_TYPE) as TransactionType,
    // Android는 대문자로 저장하므로 소문자로 변환
    category: (data.category || 'etc').toLowerCase(),
    cardType: data.cardType?.toLowerCase() || (data.cardLastFour === '1876' ? 'sam' : 'main'),
    cardLastFour: data.cardLastFour,
    memo: data.memo,
    mergedFrom: data.mergedFrom,
    splitGroupId: data.splitGroupId,
    splitIndex: data.splitIndex,
    splitTotal: data.splitTotal,
  };
}

function matchesTransactionType(
  expense: Expense,
  transactionType: TransactionType | undefined
): boolean {
  if (!transactionType) {
    return true;
  }

  return (expense.transactionType || DEFAULT_TRANSACTION_TYPE) === transactionType;
}

function normalizeSearchText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function compactSearchText(value: string | undefined): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function parseExactCardSearchKeyword(keyword: string): ExactCardSearchKeyword | null {
  const match = keyword.trim().match(EXACT_CARD_KEYWORD_PATTERN);
  if (!match) {
    return null;
  }

  const label = match[1].trim();
  if (!getKnownCardLabelAliasGroup(label)) {
    return null;
  }

  const token = normalizeCardToken(match[2]);
  if (!token) {
    return null;
  }

  return {
    label,
    token,
  };
}

function extractCardLabel(cardValue: string | undefined): string {
  const value = cardValue?.trim() || '';
  if (!value) {
    return '';
  }

  const match = value.match(/^(.+?)\s*\(/);
  if (match) {
    return match[1].trim();
  }

  return /^[0-9*xX＊]{4}$/.test(value) ? '' : value;
}

function normalizeCardToken(cardValue: string | undefined): string {
  const value = cardValue?.trim() || '';
  const token = value.match(/\(([0-9*xX＊]{4})\)/)?.[1] || value;

  return token
    .toLowerCase()
    .replace(/＊/g, 'x')
    .replace(/\*/g, 'x')
    .replace(/[^0-9x]/g, '')
    .slice(-4);
}

function matchesCardToken(leftToken: string, rightToken: string): boolean {
  if (!leftToken || !rightToken || leftToken.length !== rightToken.length) {
    return false;
  }

  return leftToken
    .split('')
    .every((char, index) => char === rightToken[index] || char === 'x' || rightToken[index] === 'x');
}

function getKnownCardLabelAliasGroup(label: string): readonly string[] | null {
  const normalizedLabel = compactSearchText(label);
  return CARD_LABEL_ALIAS_GROUPS.find((group) =>
    group.some((alias) => compactSearchText(alias) === normalizedLabel)
  ) || null;
}

function getCardLabelAliasGroup(label: string): readonly string[] {
  return getKnownCardLabelAliasGroup(label) || [label];
}

function matchesCardLabel(leftLabel: string, rightLabel: string): boolean {
  const normalizedLeft = compactSearchText(leftLabel);
  const normalizedRight = compactSearchText(rightLabel);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftAliases = getCardLabelAliasGroup(leftLabel).map(compactSearchText);
  const rightAliases = getCardLabelAliasGroup(rightLabel).map(compactSearchText);

  return leftAliases.some((alias) => rightAliases.includes(alias));
}

function getExpenseCardSearchTexts(expense: Expense): string[] {
  const cardValue = expense.cardLastFour || '';
  const cardLabel = extractCardLabel(cardValue);
  const cardToken = normalizeCardToken(cardValue);
  const cardType = expense.cardType || '';
  const searchTexts = [cardValue, cardType, ...(CARD_TYPE_SEARCH_TERMS[cardType] || [])];

  if (cardLabel) {
    searchTexts.push(...getCardLabelAliasGroup(cardLabel));
  }

  if (cardLabel && cardToken) {
    searchTexts.push(
      `${cardLabel}(${cardToken})`,
      ...getCardLabelAliasGroup(cardLabel).map((alias) => `${alias}(${cardToken})`)
    );
  }

  if (cardToken) {
    searchTexts.push(cardToken, `(${cardToken})`);
  }

  return searchTexts;
}

function matchesCardSearch(expense: Expense, keyword: string): boolean {
  const exactCardKeyword = parseExactCardSearchKeyword(keyword);
  const cardValue = expense.cardLastFour || '';

  if (exactCardKeyword) {
    const cardLabel = extractCardLabel(cardValue);
    const cardToken = normalizeCardToken(cardValue);

    return (
      matchesCardLabel(cardLabel, exactCardKeyword.label) &&
      matchesCardToken(cardToken, exactCardKeyword.token)
    );
  }

  const compactKeyword = compactSearchText(keyword);
  if (!compactKeyword) {
    return false;
  }

  return getExpenseCardSearchTexts(expense).some((value) =>
    compactSearchText(value).includes(compactKeyword)
  );
}

/**
 * 지출 추가
 */
export async function addExpense(
  expense: Omit<Expense, 'id'>,
  options: AddExpenseOptions = {}
): Promise<string> {
  const householdId = getHouseholdId();
  const { notifyOnCreate = true } = options;
  const createdBy = notifyOnCreate ? MemberStorage.getMemberName() : null;
  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    ...expense,
    transactionType: expense.transactionType || DEFAULT_TRANSACTION_TYPE,
    householdId,
    createdAt: Timestamp.now(),
    ...(createdBy && { createdBy }),
  });
  return docRef.id;
}

/**
 * 지출 수정
 */
export async function updateExpense(id: string, data: Partial<Expense>): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, data);
}

/**
 * 지출 삭제
 */
export async function deleteExpense(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
}

/**
 * 특정 월의 지출 목록 실시간 구독
 */
export function subscribeToMonthlyExpenses(
  year: number,
  month: number,
  callback: (expenses: Expense[]) => void,
  options: ExpenseQueryOptions = { transactionType: DEFAULT_TRANSACTION_TYPE }
): () => void {
  const householdId = getHouseholdId();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  // householdId로 필터링 (인덱스 없이 클라이언트에서 정렬)
  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const allExpenses = snapshot.docs.map(mapDocToExpense);

    // 클라이언트에서 날짜 필터링 및 정렬
    const filtered = allExpenses
      .filter((e) => e.date >= startDate && e.date <= endDate)
      .filter((e) => matchesTransactionType(e, options.transactionType))
      .sort((a, b) => b.date.localeCompare(a.date));

    callback(filtered);
  }, (error) => {
    callback([]);
  });

  return unsubscribe;
}

/**
 * 지출의 카테고리 업데이트
 */
export async function updateExpenseCategory(id: string, category: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, { category });
}

/**
 * 기간별 지출 목록 실시간 구독
 */
export function subscribeToDateRangeExpenses(
  startDate: string,  // YYYY-MM-DD
  endDate: string,    // YYYY-MM-DD
  callback: (expenses: Expense[]) => void,
  options: ExpenseQueryOptions = { transactionType: DEFAULT_TRANSACTION_TYPE }
): () => void {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const allExpenses = snapshot.docs.map(mapDocToExpense);

    const filtered = allExpenses
      .filter((e) => e.date >= startDate && e.date <= endDate)
      .filter((e) => matchesTransactionType(e, options.transactionType))
      .sort((a, b) => b.date.localeCompare(a.date));

    callback(filtered);
  }, (error) => {
    callback([]);
  });

  return unsubscribe;
}

/**
 * 수동 지출 추가
 */
export async function addManualExpense(
  merchant: string,
  amount: number,
  category: string,
  date: string,
  memo?: string,
  transactionType: TransactionType = DEFAULT_TRANSACTION_TYPE
): Promise<string> {
  const householdId = getHouseholdId();
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    date,
    time,
    merchant,
    amount,
    transactionType,
    category,
    cardType: 'manual',
    cardLastFour: '수동',
    memo: memo || '',
    householdId,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

/**
 * 잘못된 카테고리 일괄 수정
 */
export async function fixInvalidCategories(
  validCategories: string[]
): Promise<number> {
  const householdId = getHouseholdId();
  const categoryMap: Record<string, string> = {
    'baby': 'childcare',
    'transport': 'living',
    'medical': 'living',
  };

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );
  const snapshot = await getDocs(q);

  let fixedCount = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const category = (data.category || '').toLowerCase();

    // 유효한 카테고리가 아닌 경우
    if (!validCategories.includes(category)) {
      const newCategory = categoryMap[category] || 'etc';
      await updateDoc(doc(db, COLLECTION_NAME, docSnap.id), { category: newCategory });
      fixedCount++;
    }
  }

  return fixedCount;
}

/**
 * 지출 분할
 * 원본 지출을 삭제하고 여러 개의 새 지출로 분할
 */
export interface SplitItem {
  merchant: string;
  amount: number;
  category: string;
  memo?: string;
}

export async function splitExpense(
  originalExpense: Expense,
  splits: SplitItem[]
): Promise<string[]> {
  const householdId = getHouseholdId();

  return runTransaction(db, async (transaction) => {
    // 원본 지출 삭제
    const originalRef = doc(db, COLLECTION_NAME, originalExpense.id);
    transaction.delete(originalRef);

    // 분할된 지출들 추가
    const newIds: string[] = [];
    for (const split of splits) {
      const newDocRef = doc(collection(db, COLLECTION_NAME));
      const expenseData: Record<string, unknown> = {
        date: originalExpense.date,
        time: originalExpense.time,
        merchant: split.merchant,
        amount: split.amount,
        transactionType: originalExpense.transactionType || DEFAULT_TRANSACTION_TYPE,
        category: split.category,
        cardType: originalExpense.cardType,
        cardLastFour: originalExpense.cardLastFour,
        memo: split.memo || '',
        householdId,
        createdAt: Timestamp.now(),
      };
      transaction.set(newDocRef, expenseData);
      newIds.push(newDocRef.id);
    }

    return newIds;
  });
}

/**
 * 지출 합치기
 * 소스 지출을 타겟 지출에 합침 (타겟의 가맹점명, 카테고리 유지)
 * 원본 정보를 저장하여 되돌리기 가능
 */
export async function mergeExpenses(
  targetExpense: Expense,
  sourceExpense: Expense
): Promise<void> {
  return runTransaction(db, async (transaction) => {
    // 타겟 지출의 금액을 합산
    const newAmount = targetExpense.amount + sourceExpense.amount;

    // 원본 정보 저장 (되돌리기용)
    const existingMerged = targetExpense.mergedFrom || [];
    const mergedFrom: MergedExpenseInfo[] = [
      ...existingMerged,
      // 타겟이 아직 합쳐진 적 없으면 타겟 정보도 저장
      ...(existingMerged.length === 0 ? [{
        merchant: targetExpense.merchant,
        amount: targetExpense.amount,
        category: targetExpense.category,
        memo: targetExpense.memo || '',
      }] : []),
      // 소스 정보 저장
      {
        merchant: sourceExpense.merchant,
        amount: sourceExpense.amount,
        category: sourceExpense.category,
        memo: sourceExpense.memo || '',
      },
    ];

    // 타겟 지출 업데이트
    const targetRef = doc(db, COLLECTION_NAME, targetExpense.id);
    transaction.update(targetRef, { amount: newAmount, mergedFrom });

    // 소스 지출 삭제
    const sourceRef = doc(db, COLLECTION_NAME, sourceExpense.id);
    transaction.delete(sourceRef);
  });
}

/**
 * 합쳐진 지출 되돌리기
 * 원본 지출들을 다시 생성하고 합쳐진 지출 삭제
 */
export async function unmergeExpense(expense: Expense): Promise<string[]> {
  if (!expense.mergedFrom || expense.mergedFrom.length === 0) {
    return [];
  }

  const householdId = getHouseholdId();

  return runTransaction(db, async (transaction) => {
    const newIds: string[] = [];

    // 원본 지출들 다시 생성
    for (const original of expense.mergedFrom!) {
      const newDocRef = doc(collection(db, COLLECTION_NAME));
      const expenseData: Record<string, unknown> = {
        date: expense.date,
        time: expense.time,
        merchant: original.merchant,
        amount: original.amount,
        transactionType: expense.transactionType || DEFAULT_TRANSACTION_TYPE,
        category: original.category,
        cardType: expense.cardType,
        cardLastFour: expense.cardLastFour,
        memo: original.memo || '',
        householdId,
        createdAt: Timestamp.now(),
      };
      transaction.set(newDocRef, expenseData);
      newIds.push(newDocRef.id);
    }

    // 합쳐진 지출 삭제
    const expenseRef = doc(db, COLLECTION_NAME, expense.id);
    transaction.delete(expenseRef);

    return newIds;
  });
}

/**
 * 키워드로 지출 검색
 * 가맹점명, 메모, 카드 정보에서 키워드 검색
 */
export async function searchExpenses(
  keyword: string,
  options: ExpenseQueryOptions = { transactionType: DEFAULT_TRANSACTION_TYPE }
): Promise<Expense[]> {
  if (!keyword.trim()) {
    return [];
  }

  const householdId = getHouseholdId();

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  const snapshot = await getDocs(q);
  const lowerKeyword = normalizeSearchText(keyword);

  const results = snapshot.docs
    .map(mapDocToExpense)
    .filter((expense) => matchesTransactionType(expense, options.transactionType))
    .filter((expense) => {
      const merchantMatch = normalizeSearchText(expense.merchant).includes(lowerKeyword);
      const memoMatch = normalizeSearchText(expense.memo).includes(lowerKeyword);
      const cardMatch = matchesCardSearch(expense, keyword);
      return merchantMatch || memoMatch || cardMatch;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return results;
}

/**
 * 월별 분할 그룹 ID 생성
 */
export function generateSplitGroupId(): string {
  return `split_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 월별 분할 그룹의 모든 지출 조회
 */
export async function getSplitGroupExpenses(splitGroupId: string): Promise<Expense[]> {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId),
    where('splitGroupId', '==', splitGroupId)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs
    .map(mapDocToExpense)
    .sort((a, b) => (a.splitIndex || 0) - (b.splitIndex || 0));
}

/**
 * 월별 분할 취소 (합치기)
 * 분할된 지출들을 삭제하고 원래 금액의 단일 지출로 복원
 */
export async function cancelSplitGroup(splitGroupId: string): Promise<void> {
  const expenses = await getSplitGroupExpenses(splitGroupId);
  if (expenses.length === 0) return;

  const householdId = getHouseholdId();
  const firstExpense = expenses[0];
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
  // 가맹점명에서 분할 표시 제거 (예: "스타벅스 (1/3)" -> "스타벅스")
  const baseMerchant = firstExpense.merchant.replace(/\s*\(\d+\/\d+\)$/, '');

  await runTransaction(db, async (transaction) => {
    // 분할된 지출 모두 삭제
    for (const expense of expenses) {
      const docRef = doc(db, COLLECTION_NAME, expense.id);
      transaction.delete(docRef);
    }

    // 원래 금액의 단일 지출 생성 (첫 번째 항목의 메모 유지)
    const cardType = firstExpense.cardType || 'main';
    const newDocRef = doc(collection(db, COLLECTION_NAME));
    const expenseData: Record<string, unknown> = {
      date: firstExpense.date,
      time: firstExpense.time || '09:00',
      merchant: baseMerchant,
      amount: totalAmount,
      transactionType: firstExpense.transactionType || DEFAULT_TRANSACTION_TYPE,
      category: firstExpense.category,
      cardType,
      memo: firstExpense.memo || '',
      householdId,
      createdAt: Timestamp.now(),
    };
    transaction.set(newDocRef, expenseData);
  });
}

/**
 * 월별 분할 그룹 개월 수 수정
 * 기존 그룹 삭제 후 새로운 개월 수로 재생성
 */
export async function updateSplitGroup(
  splitGroupId: string,
  newMonths: number
): Promise<string> {
  const expenses = await getSplitGroupExpenses(splitGroupId);
  if (expenses.length === 0) {
    throw new Error('분할 그룹을 찾을 수 없습니다.');
  }

  // 원본 정보 계산
  const firstExpense = expenses[0];
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
  const monthlyAmount = Math.floor(totalAmount / newMonths);
  // 가맹점명에서 기존 분할 표시 제거 (예: "스타벅스 (1/3)" -> "스타벅스")
  const baseMerchant = firstExpense.merchant.replace(/\s*\(\d+\/\d+\)$/, '');

  // 새 그룹 ID 생성
  const newGroupId = generateSplitGroupId();
  const householdId = getHouseholdId();

  await runTransaction(db, async (transaction) => {
    // 기존 그룹 삭제
    for (const expense of expenses) {
      const docRef = doc(db, COLLECTION_NAME, expense.id);
      transaction.delete(docRef);
    }

    // 새로운 분할 지출 생성
    const cardType = firstExpense.cardType || 'main';
    for (let i = 0; i < newMonths; i++) {
      const dateStr = getMonthlySplitDate(firstExpense.date, i);

      const newDocRef = doc(collection(db, COLLECTION_NAME));
      const expenseData: Record<string, unknown> = {
        date: dateStr,
        time: firstExpense.time || '09:00',
        merchant: `${baseMerchant} (${i + 1}/${newMonths})`,
        amount: monthlyAmount,
        transactionType: firstExpense.transactionType || DEFAULT_TRANSACTION_TYPE,
        category: firstExpense.category,
        cardType,
        memo: firstExpense.memo || '',
        splitGroupId: newGroupId,
        splitIndex: i + 1,
        splitTotal: newMonths,
        householdId,
        createdAt: Timestamp.now(),
      };
      transaction.set(newDocRef, expenseData);
    }
  });

  return newGroupId;
}
