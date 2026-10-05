export const HOME_CARD_TYPES = [
  "LOCAL_CURRENCY_BALANCE",
  "MONTHLY_REMAINING_BUDGET",
  "MONTHLY_EXPENSE",
  "YEARLY_EXPENSE",
] as const;

export type HomeCardType = (typeof HOME_CARD_TYPES)[number];

export const WEB_HOME_CARD_TYPE: ReadonlyMap<string, HomeCardType> = new Map([
  ["localCurrencyBalance", "LOCAL_CURRENCY_BALANCE"],
  ["monthlyRemainingBudget", "MONTHLY_REMAINING_BUDGET"],
  ["monthlySpent", "MONTHLY_EXPENSE"],
  ["yearlySpent", "YEARLY_EXPENSE"],
]);

export function isHomeCardType(value: unknown): value is HomeCardType {
  return typeof value === "string" && HOME_CARD_TYPES.includes(value as HomeCardType);
}

export const DEFAULT_HOME_CONFIGURATION = {
  left: "MONTHLY_EXPENSE",
  right: "MONTHLY_REMAINING_BUDGET",
} as const;
