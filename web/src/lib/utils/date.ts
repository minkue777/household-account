export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTodayLocalDate(): string {
  return getSeoulCalendarDate(new Date());
}

export function getSeoulLocalTime(instant = new Date()): string {
  return instant.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function getSeoulCalendarParts(instant = new Date()): { year: number; month: number; day: number } {
  const seoul = new Date(instant.getTime() + 9 * 60 * 60 * 1000);
  return { year: seoul.getUTCFullYear(), month: seoul.getUTCMonth() + 1, day: seoul.getUTCDate() };
}

export function getSeoulCalendarDate(instant: Date): string {
  const { year, month, day } = getSeoulCalendarParts(instant);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
