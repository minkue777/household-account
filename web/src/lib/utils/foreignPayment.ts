import type { ForeignPayment } from '@/types/expense';

export function readForeignPayment(value: unknown): ForeignPayment | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  if (data.currency !== 'JPY' || !Number.isSafeInteger(data.amount) || (data.amount as number) <= 0 ||
      typeof data.rateInWon !== 'number' || !Number.isFinite(data.rateInWon) || data.rateInWon <= 0 ||
      typeof data.rateDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.rateDate) ||
      data.provider !== 'frankfurter-ecb') return undefined;
  return { currency: 'JPY', amount: data.amount as number, rateInWon: data.rateInWon,
    rateDate: data.rateDate, provider: data.provider };
}
