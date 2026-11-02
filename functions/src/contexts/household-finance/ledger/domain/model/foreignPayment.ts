/** 원 결제 증거와 등록 시 확정한 원화 환산 근거. 통계 금액은 계속 amountInWon을 사용합니다. */
export interface ForeignPayment {
  readonly currency: "JPY";
  readonly amount: number;
  readonly rateInWon: number;
  readonly rateDate: string;
  readonly provider: "frankfurter-ecb";
}

export function readForeignPayment(value: unknown): ForeignPayment | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const data = value as Record<string, unknown>;
  if (data.currency !== "JPY" || !Number.isSafeInteger(data.amount) || (data.amount as number) <= 0 ||
      typeof data.rateInWon !== "number" || !Number.isFinite(data.rateInWon) || data.rateInWon <= 0 ||
      typeof data.rateDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(data.rateDate) ||
      data.provider !== "frankfurter-ecb") return undefined;
  return { currency: "JPY", amount: data.amount as number, rateInWon: data.rateInWon,
    rateDate: data.rateDate, provider: data.provider };
}
