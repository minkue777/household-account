import { resolveExpenseCardDisplay } from '@/lib/expenseService';

describe('ledger read card display contract', () => {
  it('canonical 수동 거래는 legacy cardLastFour가 없어도 수동으로 표시한다', () => {
    expect(resolveExpenseCardDisplay({ cardType: 'manual', cardDisplay: '수동' })).toBe('수동');
    expect(resolveExpenseCardDisplay({ source: 'manual' })).toBe('수동');
  });

  it('수동 출처는 잘못 남은 카드 표시보다 우선한다', () => {
    expect(
      resolveExpenseCardDisplay({
        cardType: 'manual',
        cardDisplay: '삼성(1840)',
        cardLastFour: '삼성(1840)',
      })
    ).toBe('수동');
  });

  it('자동 수집 거래는 canonical 표시를 사용하고 legacy 필드도 호환한다', () => {
    expect(
      resolveExpenseCardDisplay({ cardType: 'captured', cardDisplay: '삼성(1840)' })
    ).toBe('삼성(1840)');
    expect(resolveExpenseCardDisplay({ cardLastFour: '국민(1234)' })).toBe('국민(1234)');
  });
});
