import { mapCommandTransaction, mapExpenseReadData } from '@/features/ledger/application/ledgerExpenseMapping';
import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';

const document = {
  merchant: '부산식당', amountInWon: 30000, categoryId: 'food', accountingDate: '2026-09-18',
  memo: '점심', aggregateVersion: 1,
};
const result: LedgerTransactionCommandResult = {
  ...document, transactionId: 'expense-1', householdId: 'house-1', transactionType: 'expense',
  localTime: '12:00', cardDisplay: '수동', cardType: 'manual', creatorMemberId: 'member-1',
  lifecycleState: 'active', aggregateVersion: 2,
};

describe('[T-LED-011][LED-011] 태그 조회 및 저장 응답 매핑', () => {
  test('조회는 태그 없는 기존 거래를 유지하고 저장된 태그를 정규화한다', () => {
    expect(mapExpenseReadData('legacy', document)).not.toHaveProperty('tags');
    expect(mapExpenseReadData('tagged', { ...document, tags: [' #2026부산여행 ', '', '2026부산여행'] }).tags)
      .toEqual(['2026부산여행']);
  });

  test('명령 응답 태그를 반영하고 생략 응답은 보존하되 명시한 빈 배열은 제거한다', () => {
    const previous = mapExpenseReadData('expense-1', { ...document, tags: ['이전태그'] });
    expect(mapCommandTransaction(result, previous).tags).toEqual(['이전태그']);
    expect(mapCommandTransaction({ ...result, tags: ['새태그'] }, previous).tags).toEqual(['새태그']);
    expect(mapCommandTransaction({ ...result, tags: [] }, previous).tags).toEqual([]);
    expect(mapCommandTransaction({ ...result, tags: ['2026부산여행'] }).tags).toEqual(['2026부산여행']);
  });
});
