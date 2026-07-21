import type { LedgerTransactionView } from "../model/ledgerTransaction";

export type LedgerValidationResult =
  | { kind: "valid" }
  | { kind: "validation-error"; code: string };

export function validatePositiveWon(amountInWon: number): LedgerValidationResult {
  return Number.isInteger(amountInWon) && amountInWon > 0
    ? { kind: "valid" }
    : { kind: "validation-error", code: "AMOUNT_MUST_BE_POSITIVE_INTEGER" };
}

export function validateRequiredText(
  value: string,
  code: string,
): LedgerValidationResult {
  return value.trim().length > 0
    ? { kind: "valid" }
    : { kind: "validation-error", code };
}

export function validateAccountingDate(value: string): LedgerValidationResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return { kind: "validation-error", code: "ACCOUNTING_DATE_INVALID" };
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value
    ? { kind: "valid" }
    : { kind: "validation-error", code: "ACCOUNTING_DATE_INVALID" };
}

export function applyTransactionPatch(
  transaction: LedgerTransactionView,
  patch: Partial<
    Pick<
      LedgerTransactionView,
      "merchant" | "memo" | "amountInWon" | "categoryId" | "accountingDate"
    >
  >,
): LedgerTransactionView {
  return {
    ...transaction,
    ...(patch.merchant === undefined ? {} : { merchant: patch.merchant.trim() }),
    ...(patch.memo === undefined ? {} : { memo: patch.memo.trim() }),
    ...(patch.amountInWon === undefined
      ? {}
      : { amountInWon: patch.amountInWon }),
    ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
    ...(patch.accountingDate === undefined
      ? {}
      : { accountingDate: patch.accountingDate }),
    aggregateVersion: transaction.aggregateVersion + 1,
  };
}
