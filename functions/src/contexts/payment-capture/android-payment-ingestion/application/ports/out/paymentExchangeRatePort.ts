export interface PaymentExchangeRatePort {
  /** 결제일 이후의 관측을 사용하지 않습니다. 휴일에는 직전 제공일을 반환합니다. */
  getYenRate(date: string): Promise<{
    readonly rateInWon: number;
    readonly rateDate: string;
    readonly provider: "frankfurter-ecb";
  } | undefined>;
}
