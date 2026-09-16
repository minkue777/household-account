import { resolveExpenseStatisticsPeriod } from '@/features/reporting/statisticsPeriod';

const now = new Date('2026-07-19T12:34:56+09:00');

describe('실제 통계 화면의 기간 정책', () => {
  it.each([
    ['3months', '2026-05-01', '2026-07-31'],
    ['6months', '2026-02-01', '2026-07-31'],
    ['1year', '2025-08-01', '2026-07-31'],
  ])('[T-STAT-PERIOD-001][STAT-001] %s는 현재 월을 포함한 월 경계다', (preset, startDate, endDate) => {
    expect(resolveExpenseStatisticsPeriod(preset, '', '', now)).toEqual({ startDate, endDate, error: undefined });
  });

  it('[T-STAT-PERIOD-002][STAT-001] 윤년 날짜가 포함된 custom 입력을 월 경계로 정규화한다', () => {
    expect(resolveExpenseStatisticsPeriod('custom', '2024-02-29', '2024-04-03', now))
      .toEqual({ startDate: '2024-02-01', endDate: '2024-04-30', error: undefined });
  });

  it.each([['2026-01-01', ''], ['', '2026-06-30'], ['', '']])(
    '[T-STAT-PERIOD-003][STAT-001] 불완전한 custom 입력을 12개월로 대체한다 (%s, %s)', (start, end) => {
      expect(resolveExpenseStatisticsPeriod('custom', start, end, now))
        .toEqual({ startDate: '2025-08-01', endDate: '2026-07-31', error: undefined });
    }
  );

  it('[T-STAT-PERIOD-004][STAT-001] 역전된 월 범위를 뒤집지 않고 오류로 반환한다', () => {
    const result = resolveExpenseStatisticsPeriod('custom', '2026-07-01', '2026-06-30', now);
    expect(result).toMatchObject({ startDate: '2026-07-01', endDate: '2026-06-30' });
    expect(result.error).toBeDefined();
  });

  it('[T-STAT-PERIOD-005][STAT-001] UTC가 아닌 서울의 현재 월을 사용한다', () => {
    expect(resolveExpenseStatisticsPeriod('3months', '', '', new Date('2026-07-31T15:30:00Z')))
      .toEqual({ startDate: '2026-06-01', endDate: '2026-08-31', error: undefined });
  });
});
