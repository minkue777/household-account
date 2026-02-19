export const splitMonthsMinMessage = '2개월 이상부터 분할할 수 있습니다.';

export function sanitizeSplitMonthsInput(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

export function hasSplitMonthsError(input: string): boolean {
  if (input === '') return false;

  const months = Number.parseInt(input, 10);
  return Number.isNaN(months) || months < 2;
}

export function parseValidSplitMonths(input: string): number | null {
  const months = Number.parseInt(input, 10);
  if (Number.isNaN(months) || months < 2) {
    return null;
  }
  return months;
}
