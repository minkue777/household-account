import { applyPaymentOccurrenceYearPolicy } from "./domain/policies/paymentOccurrenceYear";

export interface PaymentOccurrenceYearInput {
  month: number;
  day: number;
  hour: number;
  minute: number;
  receivedAt: string;
  zoneId: "Asia/Seoul";
}

export type PaymentOccurrenceYearResult =
  | { kind: "success"; occurredLocalDateTime: string }
  | { kind: "parseFailure"; code: "INVALID_DATE" | "INVALID_TIME" };

export interface PaymentOccurrenceYearResolver {
  resolve(input: PaymentOccurrenceYearInput): PaymentOccurrenceYearResult;
}

export function resolvePaymentOccurrenceYear(
  input: PaymentOccurrenceYearInput,
): PaymentOccurrenceYearResult {
  return applyPaymentOccurrenceYearPolicy(input);
}
