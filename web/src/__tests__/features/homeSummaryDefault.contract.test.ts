import { DEFAULT_HOME_SUMMARY_CONFIG } from '@/types/household';

describe('홈 요약 기본 카드 계약', () => {
  it('저장된 설정이 없으면 X월 지출과 X월 잔여 예산을 표시한다', () => {
    expect(DEFAULT_HOME_SUMMARY_CONFIG).toEqual({
      leftCard: 'monthlySpent',
      rightCard: 'monthlyRemainingBudget',
    });
  });
});
