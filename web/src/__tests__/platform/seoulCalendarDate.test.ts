import { formatLocalDate, getSeoulCalendarDate, getSeoulCalendarParts, getTodayLocalDate, getSeoulLocalTime } from '@/lib/utils/date';

describe('[SYS-004] 단말 시간대와 독립적인 서울 달력 날짜', () => {
  afterEach(() => jest.useRealTimers());
  it.each([
    ['2026-12-31T14:59:59Z', '2026-12-31'],
    ['2026-12-31T15:00:00Z', '2027-01-01'],
    ['2026-08-31T23:30:00-07:00', '2026-09-01'],
  ])('%s는 %s이다', (instant, date) => {
    jest.useFakeTimers().setSystemTime(new Date(instant));
    expect(getTodayLocalDate()).toBe(date);
    expect(getSeoulCalendarDate(new Date(instant))).toBe(date);
    const [year, month, day] = date.split('-').map(Number);
    expect(getSeoulCalendarParts()).toEqual({ year, month, day });
  });
  it('달력에서 명시적으로 선택한 날짜는 instant 변환 없이 유지한다', () => {
    expect(formatLocalDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
  it('수동 거래 시각은 서울 시각이며 자정은 00시로 기록한다', () => {
    expect(getSeoulLocalTime(new Date('2026-08-31T15:00:00Z'))).toBe('00:00');
    expect(getSeoulLocalTime(new Date('2026-08-31T09:42:00Z'))).toBe('18:42');
  });
});
