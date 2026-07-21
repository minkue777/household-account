import { describe, expect, it } from "vitest";
import { createCompatibleLedgerReadTestSubject } from "../../../support/ledger-read-subject";

type StoredTransactionType = "expense" | "income" | string | undefined;

interface StoredLedgerRow {
  transactionId: string;
  householdId: string;
  transactionType: StoredTransactionType;
  accountingDate: string;
  localTime: string;
  amountInWon: number;
}

interface LedgerReadItem {
  transactionId: string;
  transactionType: "expense" | "income";
  accountingDate: string;
  localTime: string;
  amountInWon: number;
}

type LedgerReadResult =
  | { kind: "success"; items: readonly LedgerReadItem[] }
  | { kind: "no-data" }
  | { kind: "contract-failure"; code: string }
  | { kind: "retryable-failure"; code: string };

export interface LedgerReadCompatibilitySubject {
  list(input: {
    householdId: string;
    transactionType: "expense" | "income";
    period: { startDate: string; endDate: string };
  }): Promise<LedgerReadResult>;
}

export function createSubject(fixture: {
  rows?: readonly StoredLedgerRow[];
  failure?: { kind: "contract-failure" | "retryable-failure"; code: string };
}): LedgerReadCompatibilitySubject {
  return createCompatibleLedgerReadTestSubject(fixture);
}

const period = { startDate: "2026-07-01", endDate: "2026-07-31" };

describe("Ledger 레거시 조회 호환 계약", () => {
  it("[T-LED-001][LED-001][SYS-002] transactionType이 없는 레거시 문서만 expense로 해석한다", async () => {
    const subject = createSubject({
      rows: [
        {
          transactionId: "legacy-expense",
          householdId: "house-1",
          transactionType: undefined,
          accountingDate: "2026-07-10",
          localTime: "12:00",
          amountInWon: 10_000,
        },
        {
          transactionId: "income",
          householdId: "house-1",
          transactionType: "income",
          accountingDate: "2026-07-11",
          localTime: "12:00",
          amountInWon: 20_000,
        },
        {
          transactionId: "other-household",
          householdId: "house-2",
          transactionType: undefined,
          accountingDate: "2026-07-12",
          localTime: "12:00",
          amountInWon: 30_000,
        },
      ],
    });

    const result = await subject.list({
      householdId: "house-1",
      transactionType: "expense",
      period,
    });

    expect(result).toEqual({
      kind: "success",
      items: [
        {
          transactionId: "legacy-expense",
          transactionType: "expense",
          accountingDate: "2026-07-10",
          localTime: "12:00",
          amountInWon: 10_000,
        },
      ],
    });
  });

  it("[T-LED-001][LED-001] 같은 시각의 거래는 transactionId까지 포함한 결정적 내림차순으로 반환한다", async () => {
    const rows: StoredLedgerRow[] = ["tx-a", "tx-c", "tx-b"].map(
      (transactionId) => ({
        transactionId,
        householdId: "house-1",
        transactionType: "expense",
        accountingDate: "2026-07-10",
        localTime: "12:00",
        amountInWon: 1_000,
      }),
    );

    const result = await createSubject({ rows }).list({
      householdId: "house-1",
      transactionType: "expense",
      period,
    });

    expect(result).toMatchObject({
      kind: "success",
      items: [
        { transactionId: "tx-c" },
        { transactionId: "tx-b" },
        { transactionId: "tx-a" },
      ],
    });
  });

  it.each([
    ["contract-failure", "LEDGER_ROW_SCHEMA_INVALID"],
    ["retryable-failure", "LEDGER_REPOSITORY_UNAVAILABLE"],
  ] as const)(
    "[T-LED-001][LED-001] %s를 빈 목록이나 NoData로 축약하지 않는다",
    async (kind, code) => {
      const result = await createSubject({ failure: { kind, code } }).list({
        householdId: "house-1",
        transactionType: "expense",
        period,
      });

      expect(result).toEqual({ kind, code });
    },
  );
});
