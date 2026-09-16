import { getSeoulLocalTime } from '@/lib/utils/date';
import {
  collection,
  doc,
  getDocFromServer,
  query,
  where,
  onSnapshot,
  getDocs,
  getDocsFromServer,
  limit,
  QueryDocumentSnapshot,
  QuerySnapshot,
  DocumentData,
  db,
} from '@/platform/read-model/firestoreReadModel';
import { Expense, MergedExpenseInfo, TransactionType } from '@/types/expense';
import { ledgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import { isVisibleLedgerReadDocument } from '@/features/ledger/application/ledgerReadVisibility';
import { requireClientSessionScope } from '@/composition/clientSessionScope';
import {
  ledgerMergedTransactionId,
  type LedgerTransactionCommandResult,
} from '@/platform/functions-api/householdCommandContract';
import { createHouseholdCommandId } from '@/platform/functions-api/householdCommandClient';
import { mapDocToExpense, mapExpenseReadData, mapCommandTransaction } from '@/features/ledger/application/ledgerExpenseMapping';
export { mapDocToExpense, resolveExpenseCardDisplay } from '@/features/ledger/application/ledgerExpenseMapping';

const COLLECTION_NAME = 'expenses';
const DEFAULT_TRANSACTION_TYPE: TransactionType = 'expense';
const SEARCH_SOURCE_QUERY_LIMIT = 10_000;

interface AddExpenseOptions {
  notifyOnCreate?: boolean;
}

interface ExpenseQueryOptions {
  transactionType?: TransactionType;
  onError?: (error: unknown) => void;
}

interface ExactCardSearchKeyword {
  label: string;
  token: string;
}

async function loadLedgerCommands() {
  return (await import('@/features/ledger/application/ledgerCommands')).ledgerCommands;
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
  return requireClientSessionScope().householdId;
}

/** 알림 편집 링크는 현재 달 목록과 무관하게 자기 가구의 한 건을 권위 조회합니다. */
export async function getExpenseForEdit(id: string): Promise<Expense | null> {
  const scope = requireClientSessionScope();
  const snapshot = await getDocFromServer(doc(db, COLLECTION_NAME, id));
  const current = requireClientSessionScope();
  if (current.householdId !== scope.householdId || current.sessionGeneration !== scope.sessionGeneration
    || current.principalUid !== scope.principalUid) throw new Error('세션이 변경되었습니다.');
  const data = snapshot.data();
  return data && data.householdId === scope.householdId && isVisibleLedgerReadDocument(data)
    ? mapExpenseReadData(snapshot.id, data) : null;
}

/** Each listener owns its source; the first accepted server event may follow ignored cache events. */
function createExpenseSnapshotReader(): (snapshot: QuerySnapshot<DocumentData>) => Expense[] {
  let current: Map<string, Expense> | undefined;
  return (snapshot) => {
    // Commit the source only after the complete event has been decoded.
    const next = new Map(current);
    const put = (document: QueryDocumentSnapshot<DocumentData>) => {
      const data = document.data();
      if (isVisibleLedgerReadDocument(data)) next.set(document.id, mapExpenseReadData(document.id, data));
      else next.delete(document.id);
    };
    try {
      if (current === undefined) {
        snapshot.docs.forEach(put);
      } else {
        for (const change of snapshot.docChanges()) {
          if (change.type === 'removed') next.delete(change.doc.id);
          else put(change.doc);
        }
      }
    } catch (error) {
      // Firestore's change cursor still advanced. Rebuild from all documents
      // next time so changes from this rejected event cannot be lost.
      current = undefined;
      throw error;
    }
    current = next;
    return Array.from(next.values());
  };
}

function deterministicLedgerTransactionId(commandId: string): string {
  const bytes = new TextEncoder().encode(commandId);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const encoded = globalThis.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `ledger-${encoded.slice(0, 80)}`;
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
  const cardValue = expense.cardEvidence || expense.cardLastFour || '';
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
  const cardValue = expense.cardEvidence || expense.cardLastFour || '';

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

export function expenseMatchesSearch(expense: Expense, keyword: string): boolean {
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) return false;
  return normalizeSearchText(expense.merchant).includes(normalizedKeyword)
    || normalizeSearchText(expense.memo).includes(normalizedKeyword)
    || matchesCardSearch(expense, keyword);
}

export function subscribeToExpenseProjection(
  callback: (expenses: Expense[]) => void,
  accept: (expense: Expense) => boolean
) {
  return ledgerOptimisticProjection.subscribe(callback, accept, getHouseholdId());
}

/**
 * 지출 추가
 */
export async function addExpense(
  expense: Omit<Expense, 'id' | 'aggregateVersion'>,
  options: AddExpenseOptions = {}
): Promise<string> {
  const householdId = getHouseholdId();
  void options;
  const transaction = {
    ...expense,
    transactionType: expense.transactionType || DEFAULT_TRANSACTION_TYPE,
  };
  const commandId = createHouseholdCommandId('ledger-record');
  const optimistic: Expense = {
    ...transaction,
    id: deterministicLedgerTransactionId(commandId),
    aggregateVersion: 1,
  };
  const mutationId = ledgerOptimisticProjection.beginCreate(optimistic, householdId);
  try {
    const ledgerCommands = await loadLedgerCommands();
    const confirmed = await ledgerCommands.record(householdId, transaction, commandId);
    ledgerOptimisticProjection.commitCreate(mutationId, mapCommandTransaction(confirmed));
    return confirmed.transactionId;
  } catch (error) {
    ledgerOptimisticProjection.rollback(mutationId);
    throw error;
  }
}

/**
 * 지출 수정
 */
export async function updateExpense(
  id: string,
  data: Partial<Expense>,
  expectedVersion: number,
  rememberForNextTime = false
): Promise<void> {
  return updateExpenseWithCommand(id, data, (commands, householdId) =>
    commands.update(householdId, id, expectedVersion, data, rememberForNextTime));
}

/** 일반 편집과 카테고리 편집은 같은 낙관적 변경·확정·실패 복구 경계를 사용합니다. */
async function updateExpenseWithCommand(
  id: string,
  patch: Partial<Expense>,
  execute: (
    commands: Awaited<ReturnType<typeof loadLedgerCommands>>,
    householdId: string
  ) => Promise<LedgerTransactionCommandResult>
): Promise<void> {
  const householdId = getHouseholdId();
  const current = ledgerOptimisticProjection.current(id, householdId);
  const mutationId = ledgerOptimisticProjection.beginUpdate(id, patch, householdId);
  try {
    const ledgerCommands = await loadLedgerCommands();
    const updated = await execute(ledgerCommands, householdId);
    ledgerOptimisticProjection.commitUpdate(mutationId, mapCommandTransaction(updated, current));
  } catch (error) {
    ledgerOptimisticProjection.rollback(mutationId);
    throw error;
  }
}

/**
 * 지출 삭제
 */
export async function deleteExpense(id: string, expectedVersion: number): Promise<void> {
  const householdId = getHouseholdId();
  const mutationId = ledgerOptimisticProjection.beginDelete(id, householdId);
  try {
    const ledgerCommands = await loadLedgerCommands();
    await ledgerCommands.delete(householdId, id, expectedVersion);
    ledgerOptimisticProjection.commitDelete(mutationId);
  } catch (error) {
    ledgerOptimisticProjection.rollback(mutationId);
    throw error;
  }
}

function subscribeToMonthlyTransactionSource(
  year: number,
  month: number,
  callback: (transactions: Expense[]) => void,
  transactionType: TransactionType | undefined,
  onError?: (error: unknown) => void
): () => void {
  const householdId = getHouseholdId();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
  const projection = ledgerOptimisticProjection.subscribe(
    callback,
    (expense) =>
      expense.date >= startDate
      && expense.date <= endDate
      && matchesTransactionType(expense, transactionType),
    householdId,
    `transactions:${startDate}:${endDate}:${transactionType ?? 'all'}`
  );

  // 동일한 공개 read model을 모든 Web runtime에서 실시간 구독합니다.
  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );

  const readSnapshot = createExpenseSnapshotReader();
  let hasServerSnapshot = false;
  const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
    if (!hasServerSnapshot && snapshot.metadata.fromCache) return;
    hasServerSnapshot = true;
    // Metadata events still advance authority/reconciliation, without decoding unchanged rows.
    projection.publish(readSnapshot(snapshot));
  }, (error) => {
    onError?.(error);
  });

  return () => {
    unsubscribe();
    projection.dispose();
  };
}

/**
 * 특정 월의 지출과 수입을 하나의 실시간 원본으로 구독합니다.
 *
 * 화면의 거래 유형 전환은 이 원본을 다시 구독하지 않고 메모리에서 파생합니다.
 */
export function subscribeToMonthlyTransactions(
  year: number,
  month: number,
  callback: (transactions: Expense[]) => void,
  options: Pick<ExpenseQueryOptions, 'onError'> = {}
): () => void {
  return subscribeToMonthlyTransactionSource(
    year,
    month,
    callback,
    undefined,
    options.onError
  );
}

/**
 * 인접 월 화면 전환을 위한 일회성 원장 조회입니다.
 *
 * listener를 유지하지 않으며 반환값은 현재 브라우저 세션의 메모리 힌트로만
 * 사용합니다. 해당 월을 실제로 선택하면 실시간 구독이 권위 서버 snapshot으로
 * 다시 수렴시킵니다.
 */
export async function readMonthlyTransactionsForPrefetch(
  year: number,
  month: number
): Promise<Expense[]> {
  const householdId = getHouseholdId();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  const snapshot = await getDocsFromServer(q);

  return snapshot.docs
    .filter((document) => isVisibleLedgerReadDocument(document.data()))
    .map(mapDocToExpense);
}

/**
 * 지출의 카테고리 업데이트
 */
export async function updateExpenseCategory(
  id: string,
  category: string,
  expectedVersion: number
): Promise<void> {
  return updateExpenseWithCommand(id, { category }, (commands, householdId) =>
    commands.changeCategory(householdId, id, category, expectedVersion));
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
  const transactionType = options.transactionType ?? DEFAULT_TRANSACTION_TYPE;
  const projection = ledgerOptimisticProjection.subscribe(
    callback,
    (expense) =>
      expense.date >= startDate
      && expense.date <= endDate
      && matchesTransactionType(expense, transactionType),
    householdId,
    `transactions:${startDate}:${endDate}:${transactionType}`
  );

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );

  const readSnapshot = createExpenseSnapshotReader();
  const unsubscribe = onSnapshot(q, (snapshot) => {
    projection.publish(readSnapshot(snapshot));
  }, (error) => {
    options.onError?.(error);
  });

  return () => {
    unsubscribe();
    projection.dispose();
  };
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
  const time = getSeoulLocalTime();

  return addExpense({
    date,
    time,
    merchant,
    amount,
    transactionType,
    category,
    cardType: 'manual',
    cardLastFour: '수동',
    memo: memo || '',
  });
}

export async function addManualMonthlySplit(
  merchant: string,
  amount: number,
  category: string,
  date: string,
  months: number,
  memo?: string
): Promise<string[]> {
  const ledgerCommands = await loadLedgerCommands();
  const result = await ledgerCommands.recordMonthlySplit(getHouseholdId(), {
    merchant,
    amountInWon: amount,
    categoryId: category,
    accountingDate: date,
    ...(memo !== undefined ? { memo } : {}),
    months,
  });
  return result.transactionIds;
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
  const ledgerCommands = await loadLedgerCommands();
  return ledgerCommands.split(
    householdId,
    originalExpense.id,
    originalExpense.aggregateVersion,
    splits
  );
}

export async function splitExpenseMonthly(
  expense: Expense,
  months: number
): Promise<string[]> {
  const householdId = getHouseholdId();
  const ledgerCommands = await loadLedgerCommands();
  const result = await ledgerCommands.splitExistingMonthly(
    householdId,
    expense.id,
    expense.aggregateVersion,
    months
  );
  return result.transactionIds;
}

/**
 * 지출 합치기
 * 소스 지출을 타겟 지출에 합침 (타겟의 가맹점명, 카테고리 유지)
 * 원본 정보를 저장하여 되돌리기 가능
 */
export async function mergeExpenses(
  targetExpense: Expense,
  sourceExpense: Expense
): Promise<string> {
  const householdId = getHouseholdId();
  const commandId = createHouseholdCommandId('ledger-merge');
  const mergedTransactionId = ledgerMergedTransactionId(commandId);
  const leafIds = [
    ...(targetExpense.mergeLeafIds ?? [targetExpense.id]),
    ...(sourceExpense.mergeLeafIds ?? [sourceExpense.id]),
  ];
  const restorationDetails = mergeRestorationDetails(
    targetExpense,
    sourceExpense
  );
  const mergedExpense: Expense = {
    ...targetExpense,
    id: mergedTransactionId,
    aggregateVersion: 1,
    amount: targetExpense.amount + sourceExpense.amount,
    mergeLeafIds: leafIds,
    ...(restorationDetails === undefined
      ? { mergedFrom: undefined }
      : { mergedFrom: restorationDetails }),
  };

  const mutationIds: string[] = [];
  try {
    mutationIds.push(
      ledgerOptimisticProjection.beginDelete(targetExpense.id, householdId)
    );
    mutationIds.push(
      ledgerOptimisticProjection.beginDelete(sourceExpense.id, householdId)
    );
    mutationIds.push(
      ledgerOptimisticProjection.beginCreate(mergedExpense, householdId)
    );
  } catch (error) {
    mutationIds.forEach((mutationId) => {
      ledgerOptimisticProjection.rollback(mutationId);
    });
    throw error;
  }

  try {
    const ledgerCommands = await loadLedgerCommands();
    const result = await ledgerCommands.merge(
      householdId,
      targetExpense.id,
      targetExpense.aggregateVersion,
      sourceExpense.id,
      sourceExpense.aggregateVersion,
      commandId
    );
    if (result.transactionId !== mergedTransactionId) {
      throw new Error('LEDGER_MERGED_TRANSACTION_ID_MISMATCH');
    }
    ledgerOptimisticProjection.commitDelete(mutationIds[0]);
    ledgerOptimisticProjection.commitDelete(mutationIds[1]);
    ledgerOptimisticProjection.commitCreate(mutationIds[2], mergedExpense);
    return mergedTransactionId;
  } catch (error) {
    mutationIds.forEach((mutationId) => {
      ledgerOptimisticProjection.rollback(mutationId);
    });
    throw error;
  }
}

function mergeRestorationDetails(
  targetExpense: Expense,
  sourceExpense: Expense
): MergedExpenseInfo[] | undefined {
  const detailsFor = (expense: Expense): MergedExpenseInfo[] | undefined => {
    if (expense.mergeLeafIds && expense.mergeLeafIds.length > 0) {
      return expense.mergedFrom?.length === expense.mergeLeafIds.length
        ? expense.mergedFrom.map((item) => ({ ...item }))
        : undefined;
    }
    if (expense.mergedFrom && expense.mergedFrom.length > 0) {
      return expense.mergedFrom.map((item) => ({ ...item }));
    }
    return [{
      merchant: expense.merchant,
      amount: expense.amount,
      category: expense.category,
      ...(expense.memo === undefined ? {} : { memo: expense.memo }),
    }];
  };

  const targetDetails = detailsFor(targetExpense);
  const sourceDetails = detailsFor(sourceExpense);
  return targetDetails === undefined || sourceDetails === undefined
    ? undefined
    : [...targetDetails, ...sourceDetails];
}

/**
 * 합쳐진 지출 되돌리기
 * 원본 지출들을 다시 생성하고 합쳐진 지출 삭제
 */
export async function unmergeExpense(expense: Expense): Promise<string[]> {
  if (
    (!expense.mergeLeafIds || expense.mergeLeafIds.length === 0)
    && (!expense.mergedFrom || expense.mergedFrom.length === 0)
  ) {
    return [];
  }
  const ledgerCommands = await loadLedgerCommands();
  return ledgerCommands.unmerge(getHouseholdId(), expense.id, expense.aggregateVersion);
}

export async function restoreItemSplit(expense: Expense): Promise<void> {
  const sourceId = expense.derivedFromTransactionId;
  if (!sourceId) throw new Error('항목 분할 원본을 찾을 수 없습니다.');
  const householdId = getHouseholdId();
  const siblings = await getDocs(query(collection(db, COLLECTION_NAME), where('householdId', '==', householdId), where('derivedFromTransactionId', '==', sourceId)));
  const versions = Object.fromEntries(siblings.docs.filter(doc => isVisibleLedgerReadDocument(doc.data())).map(doc => [doc.id, Number(doc.data().aggregateVersion ?? 1)]));
  versions[expense.id] = expense.aggregateVersion;
  const commands = await loadLedgerCommands();
  await commands.restoreItemSplit(householdId, sourceId, versions);
}

/**
 * 키워드로 지출 검색
 * 가맹점명, 메모, 카드 정보에서 키워드 검색
 */
export async function searchExpenses(
  keyword: string,
  options: ExpenseQueryOptions = { transactionType: DEFAULT_TRANSACTION_TYPE }
): Promise<Expense[]> {
  return (await searchExpensePage(keyword, options)).items;
}

export interface ExpenseSearchSummary { count: number; amount: number; months: Record<string, { count: number; amount: number }> }
export interface ExpenseSearchCursor { windowId: string; scope: string; offset: number }

export class ExpenseSearchFailure extends Error {
  constructor(readonly code: 'SOURCE_LIMIT_EXCEEDED' | 'SOURCE_WINDOW_CHANGED' | 'INVALID_PERIOD' | 'SOURCE_UNAVAILABLE') {
    super(code === 'SOURCE_LIMIT_EXCEEDED' ? '검색 대상이 조회 한도에 도달해 전체 결과를 확인할 수 없습니다.' : code === 'SOURCE_WINDOW_CHANGED' ? '검색 중 세션이 변경되었거나 검색 조건이 변경되었습니다. 다시 검색해 주세요.' : code === 'INVALID_PERIOD' ? '검색 시작일과 종료일을 확인해 주세요.' : '검색 결과를 불러오지 못했습니다.');
  }
}
let searchWindowSequence = 0;
let searchWindow: { key: string; id: string; source: Promise<Expense[]> } | undefined;
export function closeExpenseSearchWindow(windowId: string): void {
  if (searchWindow?.id === windowId) searchWindow = undefined;
}

export async function searchExpensePage(
  keyword: string,
  options: ExpenseQueryOptions & { cursor?: ExpenseSearchCursor; startDate?: string; endDate?: string; sourceWindow?: string } = { transactionType: DEFAULT_TRANSACTION_TYPE }
): Promise<{ items: Expense[]; summary: ExpenseSearchSummary; nextCursor?: ExpenseSearchCursor }> {
  const empty: ExpenseSearchSummary = { count: 0, amount: 0, months: {} };
  if (!keyword.trim()) return { items: [], summary: empty };
  const scope = requireClientSessionScope();
  const period = { startDate: options.startDate || '0001-01-01', endDate: options.endDate || '9999-12-31' };
  if (period.startDate > period.endDate) throw new ExpenseSearchFailure('INVALID_PERIOD');
  const windowId = options.sourceWindow ?? options.cursor?.windowId ?? `search-window-${++searchWindowSequence}`;
  const key = JSON.stringify([scope.principalUid, scope.sessionGeneration, scope.householdId, period, windowId]);
  const queryScope = JSON.stringify([key, keyword.trim().toLocaleLowerCase(), options.transactionType]);
  const cursor = options.cursor;
  if (cursor && (cursor.scope !== queryScope || searchWindow?.key !== key || cursor.offset < 0 || !Number.isSafeInteger(cursor.offset))) throw new ExpenseSearchFailure('SOURCE_WINDOW_CHANGED');
  if (searchWindow?.key !== key) {
    const source = (async () => {
      // Every keystroke and result page shares one bounded server snapshot.
      // Production Listen rejects limits above 10,000. At the limit we cannot
      // prove the source is complete, so never publish potentially partial totals.
      const snapshot = await getDocsFromServer(query(collection(db, COLLECTION_NAME),
        where('householdId', '==', scope.householdId),
        ...(options.startDate ? [where('date', '>=', period.startDate)] : []),
        ...(options.endDate ? [where('date', '<=', period.endDate)] : []),
        limit(SEARCH_SOURCE_QUERY_LIMIT)));
      if (snapshot.docs.length >= SEARCH_SOURCE_QUERY_LIMIT) throw new ExpenseSearchFailure('SOURCE_LIMIT_EXCEEDED');
      return snapshot.docs.flatMap(document => {
        const data = document.data();
        // Preserve the previous date-range visibility without sorting the source query.
        return typeof data.date === 'string'
          && data.date >= period.startDate && data.date <= period.endDate
          && isVisibleLedgerReadDocument(data)
          ? [mapExpenseReadData(document.id, data)]
          : [];
      });
    })().catch(error => {
      if (searchWindow?.key === key) searchWindow = undefined;
      throw error instanceof ExpenseSearchFailure ? error : new ExpenseSearchFailure('SOURCE_UNAVAILABLE');
    });
    searchWindow = { key, id: windowId, source };
  }
  const source = await searchWindow.source;
  const current = requireClientSessionScope();
  if (current.householdId !== scope.householdId || current.sessionGeneration !== scope.sessionGeneration || current.principalUid !== scope.principalUid || searchWindow?.key !== key) throw new ExpenseSearchFailure('SOURCE_WINDOW_CHANGED');
  const matched = source.filter(expense => matchesTransactionType(expense, options.transactionType) && expenseMatchesSearch(expense, keyword))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || b.id.localeCompare(a.id));
  const summary = matched.reduce<ExpenseSearchSummary>((value, expense) => {
    value.count += 1; value.amount += expense.amount;
    const month = value.months[expense.date.slice(0, 7)] ??= { count: 0, amount: 0 };
    month.count += 1; month.amount += expense.amount;
    return value;
  }, empty);
  const offset = cursor?.offset ?? 0;
  const items = matched.slice(offset, offset + 50);
  return { items, summary, ...(offset + items.length < matched.length ? { nextCursor: { windowId, scope: queryScope, offset: offset + items.length } } : {}) };
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
function expectedVersionsOf(expenses: readonly Expense[]): Record<string, number> {
  return Object.fromEntries(
    expenses.map((expense) => [expense.id, expense.aggregateVersion])
  );
}

export async function cancelSplitGroup(
  splitGroupId: string,
  groupSnapshot?: readonly Expense[]
): Promise<void> {
  const snapshot = groupSnapshot ?? await getSplitGroupExpenses(splitGroupId);
  const ledgerCommands = await loadLedgerCommands();
  await ledgerCommands.cancelMonthlySplit(
    getHouseholdId(),
    splitGroupId,
    expectedVersionsOf(snapshot)
  );
}

/**
 * 월별 분할 그룹 개월 수 수정
 * 기존 그룹 삭제 후 새로운 개월 수로 재생성
 */
export async function updateSplitGroup(
  splitGroupId: string,
  newMonths: number,
  groupSnapshot?: readonly Expense[]
): Promise<string> {
  const snapshot = groupSnapshot ?? await getSplitGroupExpenses(splitGroupId);
  const ledgerCommands = await loadLedgerCommands();
  return ledgerCommands.reconfigureMonthlySplit(
    getHouseholdId(),
    splitGroupId,
    newMonths,
    expectedVersionsOf(snapshot)
  );
}
