import type { QueryDocumentSnapshot, DocumentData } from '@/platform/read-model/firestoreReadModel';
import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';
import type { Expense, TransactionType } from '@/types/expense';
import { normalizeStoredCategoryId } from '@/lib/categoryCompatibility';

const DEFAULT_TRANSACTION_TYPE: TransactionType = 'expense';

interface LedgerCardReadFields {
  cardType?: unknown;
  cardDisplay?: unknown;
  cardLastFour?: unknown;
  source?: unknown;
}

const LEGACY_CAPTURED_CARD_TYPES = new Set([
  'captured',
  'family',
  'kb',
  'sam',
  'local_currency',
  '지역화폐',
  'bill',
]);
const LEGACY_CARD_TOKEN_SUFFIX_PATTERN = /[0-9*xX＊]{4}\)?$/;

function isLegacyCardDisplayEvidence(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  return (
    normalized !== '' &&
    normalized !== '수동' &&
    normalized !== '자동등록' &&
    normalized !== '정기지출' &&
    LEGACY_CARD_TOKEN_SUFFIX_PATTERN.test(normalized)
  );
}

/** Canonical cardDisplay와 legacy cardLastFour를 Web의 기존 표시 필드로 변환합니다. */
export function resolveExpenseCardDisplay(data: LedgerCardReadFields): string | undefined {
  const cardType = typeof data.cardType === 'string' ? data.cardType.trim().toLowerCase() : '';
  const source = typeof data.source === 'string' ? data.source.trim().toLowerCase() : '';
  const canonicalDisplay = typeof data.cardDisplay === 'string' ? data.cardDisplay.trim() : '';
  const legacyDisplay = typeof data.cardLastFour === 'string' ? data.cardLastFour.trim() : '';
  const display = canonicalDisplay || legacyDisplay;

  // source가 원장의 실제 생성 경로입니다. 과거 정기지출 문서에
  // cardType=manual이 남아 있어도 수동 입력으로 오인하지 않습니다.
  if (source === 'recurring') return '정기지출';
  if (cardType === 'manual') return '수동';
  if (LEGACY_CAPTURED_CARD_TYPES.has(cardType)) return display || undefined;
  if (cardType === 'main' && isLegacyCardDisplayEvidence(display)) {
    return display;
  }
  if (source === 'manual') return '수동';
  return display || undefined;
}

/**
 * Firestore 문서를 Expense 객체로 변환 (DRY 원칙)
 */
export function mapDocToExpense(docSnap: QueryDocumentSnapshot<DocumentData>): Expense {
  return mapExpenseReadData(docSnap.id, docSnap.data());
}

export function mapExpenseReadData(id: string, data: DocumentData): Expense {
  const cardDisplay = resolveExpenseCardDisplay(data);
  const localCurrencyType =
    typeof data.localCurrencyType === 'string' && data.localCurrencyType.trim() !== ''
      ? data.localCurrencyType.trim()
      : undefined;
  const splitGroup = typeof data.splitGroup === 'object' && data.splitGroup !== null
    ? data.splitGroup as Record<string, unknown>
    : undefined;
  const splitOriginalId =
    typeof data.splitOriginalId === 'string' && data.splitOriginalId !== ''
      ? data.splitOriginalId
      : typeof splitGroup?.originalId === 'string' && splitGroup.originalId !== ''
        ? splitGroup.originalId
        : undefined;
  const mergeLeafIds = Array.isArray(data.mergeLeafIds)
    ? data.mergeLeafIds.filter(
        (value: unknown): value is string => typeof value === 'string' && value !== ''
      )
    : undefined;
  return {
    id,
    aggregateVersion: Number.isInteger(data.aggregateVersion) && data.aggregateVersion > 0
      ? data.aggregateVersion
      : 1,
    date: data.accountingDate ?? data.date,
    time: data.localTime ?? data.time,
    merchant: data.merchant,
    amount: data.amountInWon ?? data.amount,
    transactionType: (data.transactionType || DEFAULT_TRANSACTION_TYPE) as TransactionType,
    category: normalizeStoredCategoryId(data.categoryId || data.category),
    cardType: data.cardType?.toLowerCase() || (data.source === 'manual' ? 'manual' : 'main'),
    cardLastFour: cardDisplay,
    ...(typeof data.derivedFromTransactionId === 'string' ? { derivedFromTransactionId: data.derivedFromTransactionId } : {}),
    ...(typeof data.cardEvidence === 'string' ? { cardEvidence: data.cardEvidence } : {}),
    ...(localCurrencyType === undefined ? {} : { localCurrencyType }),
    memo: data.memo,
    mergedFrom: data.mergedFrom,
    ...(mergeLeafIds === undefined ? {} : { mergeLeafIds }),
    splitGroupId: data.splitGroupId ?? splitGroup?.groupId,
    ...(splitOriginalId === undefined ? {} : { splitOriginalId }),
    splitIndex: data.splitIndex ?? splitGroup?.index,
    splitTotal: data.splitTotal ?? splitGroup?.total,
  };
}

export function mapCommandTransaction(
  transaction: LedgerTransactionCommandResult,
  previous?: Expense
): Expense {
  return {
    ...previous,
    id: transaction.transactionId,
    aggregateVersion: transaction.aggregateVersion,
    date: transaction.accountingDate,
    time: transaction.localTime,
    merchant: transaction.merchant,
    amount: transaction.amountInWon,
    transactionType: transaction.transactionType,
    category: normalizeStoredCategoryId(transaction.categoryId),
    cardType: previous?.cardType ?? transaction.cardType,
    cardLastFour: previous?.cardLastFour ?? transaction.cardDisplay,
    localCurrencyType: previous?.localCurrencyType ?? transaction.localCurrencyType,
    memo: transaction.memo,
  };
}
