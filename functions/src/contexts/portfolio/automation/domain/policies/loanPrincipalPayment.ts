export type LoanRepaymentMethod =
  | "equal-principal"
  | "equal-principal-and-interest"
  | "bullet";

export interface LoanPrincipalPaymentInput {
  readonly balance: number;
  readonly annualInterestRate: number;
  readonly monthlyPayment: number;
  readonly method: LoanRepaymentMethod;
}

export type LoanPrincipalPaymentResult =
  | { readonly kind: "success"; readonly principal: number; readonly resultingBalance: number }
  | { readonly kind: "unsupported-method"; readonly method: "bullet" }
  | {
      readonly kind: "validation-error";
      readonly code: "INVALID_AUTOMATION_AMOUNT" | "INVALID_INTEREST_RATE";
    };

export function calculateLoanPrincipalPaymentPolicy(
  input: LoanPrincipalPaymentInput,
): LoanPrincipalPaymentResult {
  if (
    !Number.isSafeInteger(input.balance) ||
    input.balance < 0 ||
    !Number.isSafeInteger(input.monthlyPayment) ||
    input.monthlyPayment <= 0
  ) {
    return { kind: "validation-error", code: "INVALID_AUTOMATION_AMOUNT" };
  }

  if (!Number.isFinite(input.annualInterestRate) || input.annualInterestRate < 0) {
    return { kind: "validation-error", code: "INVALID_INTEREST_RATE" };
  }

  if (input.method === "bullet") {
    return { kind: "unsupported-method", method: "bullet" };
  }

  const calculatedPrincipal =
    input.method === "equal-principal"
      ? input.monthlyPayment
      : Math.max(
          0,
          input.monthlyPayment -
            Math.round((input.balance * input.annualInterestRate) / 100 / 12),
        );
  const principal = Math.min(input.balance, calculatedPrincipal);

  return {
    kind: "success",
    principal,
    resultingBalance: Math.max(0, input.balance - principal),
  };
}
