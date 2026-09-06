import { formatLocalDate, getSeoulCalendarParts } from '@/lib/utils/date';

export function resolveExpenseStatisticsPeriod(preset: string, customStart: string, customEnd: string, now = new Date()) {
  const { year, month } = getSeoulCalendarParts(now);
  if (preset === 'custom' && customStart && customEnd) {
    const [startYear, startMonth] = customStart.split('-').map(Number);
    const [endYear, endMonth] = customEnd.split('-').map(Number);
    if (![startYear, startMonth, endYear, endMonth].every(Number.isInteger) || startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) return { startDate: '', endDate: '', error: '올바른 월을 선택해 주세요.' };
    const startDate = formatLocalDate(new Date(startYear, startMonth - 1, 1));
    const endDate = formatLocalDate(new Date(endYear, endMonth, 0));
    return { startDate, endDate, error: startDate > endDate ? '시작 월은 종료 월보다 늦을 수 없습니다.' : undefined };
  }
  const months = preset === '3months' ? 3 : preset === '6months' ? 6 : 12;
  return { startDate: formatLocalDate(new Date(year, month - months, 1)), endDate: formatLocalDate(new Date(year, month, 0)), error: undefined };
}

export function resolveAssetStatisticsPeriod(period: '3M' | '6M' | '1Y' | 'ALL', now = new Date()) {
  const { year, month } = getSeoulCalendarParts(now);
  const months = period === '3M' ? 3 : period === '6M' ? 6 : 12;
  return { startDate: period === 'ALL' ? undefined : formatLocalDate(new Date(year, month - months, 1)), endDate: formatLocalDate(new Date(year, month, 0)) };
}
