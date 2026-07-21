export const HOME_CARD_TYPES = [
  "LOCAL_CURRENCY_BALANCE",
  "MONTHLY_REMAINING_BUDGET",
  "MONTHLY_EXPENSE",
  "YEARLY_EXPENSE",
] as const;

export type HomeCardType = (typeof HOME_CARD_TYPES)[number];

export type HomeCardSourceState =
  | { readonly kind: "READY"; readonly amountInWon: number; readonly asOf: string }
  | { readonly kind: "NO_DATA"; readonly reason: string }
  | { readonly kind: "FAILED"; readonly code: string; readonly retryable?: true };

export function isHomeCardType(value: unknown): value is HomeCardType {
  return typeof value === "string" && HOME_CARD_TYPES.includes(value as HomeCardType);
}

export const DEFAULT_HOME_CONFIGURATION = {
  left: "LOCAL_CURRENCY_BALANCE",
  right: "MONTHLY_REMAINING_BUDGET",
} as const;
