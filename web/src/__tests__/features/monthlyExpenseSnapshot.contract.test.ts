import {
  readMonthlyExpenseSnapshot,
  writeMonthlyExpenseSnapshot,
} from '@/features/ledger/application/monthlyExpenseSnapshot';
import {
  clearClientSessionScope,
  setClientSessionScope,
} from '@/composition/clientSessionScope';

const expense = {
  id: 'expense-1',
  aggregateVersion: 1,
  date: '2026-07-23',
  merchant: '테스트',
  amount: 12_000,
  transactionType: 'expense' as const,
  category: 'living',
};

function useHousehold(householdId: string): void {
  setClientSessionScope({
    sessionGeneration: 1,
    principalUid: 'uid-1',
    householdId,
    memberId: 'member-1',
  });
}

describe('monthly expense snapshot contract', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearClientSessionScope();
  });

  afterEach(clearClientSessionScope);

  it('현재 가구와 월이 같은 마지막 원장만 복원한다', () => {
    useHousehold('household-1');
    writeMonthlyExpenseSnapshot('household-1', 2026, 7, 'expense', [expense]);

    expect(readMonthlyExpenseSnapshot(2026, 7, 'expense')).toEqual([expense]);
    expect(readMonthlyExpenseSnapshot(2026, 6, 'expense')).toBeUndefined();

    useHousehold('household-2');
    expect(readMonthlyExpenseSnapshot(2026, 7, 'expense')).toBeUndefined();
  });

  it('세션이 없거나 월 범위를 벗어난 문서는 화면에 사용하지 않는다', () => {
    expect(readMonthlyExpenseSnapshot(2026, 7, 'expense')).toBeUndefined();

    useHousehold('household-1');
    writeMonthlyExpenseSnapshot('household-1', 2026, 7, 'expense', [
      { ...expense, date: '2026-08-01' },
    ]);
    expect(readMonthlyExpenseSnapshot(2026, 7, 'expense')).toBeUndefined();
  });

  it('기존 기기에 순서 없이 저장된 같은 날짜 지출도 첫 화면부터 시간 역순으로 복원한다', () => {
    useHousehold('household-1');
    window.localStorage.setItem(
      'household-account.monthly-ledger.v1:household-1:2026-07:expense',
      JSON.stringify({
        version: 1,
        householdId: 'household-1',
        items: [
          { ...expense, id: 'emart', time: '13:10', merchant: '이마트 동탄점' },
          { ...expense, id: 'third', time: '16:20', merchant: '세 번째 지출' },
          { ...expense, id: 'local-tax', time: '19:30', merchant: '지자체세입금(앱카드)' },
          { ...expense, id: 'second', time: '17:40', merchant: '두 번째 지출' },
        ],
      })
    );

    expect(
      readMonthlyExpenseSnapshot(2026, 7, 'expense')?.map(({ merchant }) => merchant)
    ).toEqual([
      '지자체세입금(앱카드)',
      '두 번째 지출',
      '세 번째 지출',
      '이마트 동탄점',
    ]);
  });
});
