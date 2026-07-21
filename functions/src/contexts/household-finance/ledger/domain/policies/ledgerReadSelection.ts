import type { StoredLedgerReadRow } from "../model/ledgerReadFact";

export interface LedgerReadItem {
  transactionId: string;
  transactionType: "expense" | "income";
  accountingDate: string;
  localTime: string;
  amountInWon: number;
}

export type LedgerSelectionResult =
  | { kind: "success"; items: readonly LedgerReadItem[] }
  | { kind: "contract-failure"; code: "LEDGER_ROW_SCHEMA_INVALID" };

function canonicalTransactionType(
  value: string | undefined,
): "expense" | "income" | undefined {
  if (value === undefined || value === "expense") return "expense";
  if (value === "income") return "income";
  return undefined;
}

function descending(left: LedgerReadItem, right: LedgerReadItem): number {
  return (
    right.accountingDate.localeCompare(left.accountingDate) ||
    right.localTime.localeCompare(left.localTime) ||
    right.transactionId.localeCompare(left.transactionId)
  );
}

export function selectLedgerRows(input: {
  rows: readonly StoredLedgerReadRow[];
  householdId: string;
  transactionType: "expense" | "income";
  startDate: string;
  endDate: string;
}): LedgerSelectionResult {
  const items: LedgerReadItem[] = [];

  for (const row of input.rows) {
    if (
      row.householdId !== input.householdId ||
      row.accountingDate < input.startDate ||
      row.accountingDate > input.endDate ||
      (row.lifecycleState !== undefined && row.lifecycleState !== "active")
    ) {
      continue;
    }

    const transactionType = canonicalTransactionType(row.transactionType);
    if (transactionType === undefined) {
      return { kind: "contract-failure", code: "LEDGER_ROW_SCHEMA_INVALID" };
    }
    if (transactionType !== input.transactionType) continue;

    items.push({
      transactionId: row.transactionId,
      transactionType,
      accountingDate: row.accountingDate,
      localTime: row.localTime,
      amountInWon: row.amountInWon,
    });
  }

  return { kind: "success", items: items.sort(descending) };
}
