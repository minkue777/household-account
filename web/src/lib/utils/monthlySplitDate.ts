function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getMonthlySplitDate(baseDate: string, monthOffset: number): string {
  const [year, month, day] = baseDate.split('-').map(Number);
  const targetMonth = new Date(year, month - 1 + monthOffset, 1);
  const targetYear = targetMonth.getFullYear();
  const targetMonthIndex = targetMonth.getMonth();
  const lastDayOfMonth = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfMonth);

  return formatLocalDate(new Date(targetYear, targetMonthIndex, clampedDay));
}
