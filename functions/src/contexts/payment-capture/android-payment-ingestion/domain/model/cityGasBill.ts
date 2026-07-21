export interface CityGasNotificationInput {
  readonly observedAtSeoul: string;
  readonly title?: string;
  readonly body: string;
}

export type CityGasParseResult =
  | {
      readonly kind: "Parsed";
      readonly amountInWon: number;
      readonly transactionType: "fixed";
      readonly categoryKind: "bill";
      readonly billingMonth: string;
      readonly memoPolicy: "BillingTitle" | "Empty";
      readonly accountingDate: string;
      readonly accountingDateSource: "DueDate" | "ObservedDateFallback";
    }
  | {
      readonly kind: "Ignored";
      readonly code: "NOT_CITY_GAS_BILL" | "TOTAL_AMOUNT_MISSING";
    };
