import { describe, expect, it } from "vitest";
import { createReportingCategoryActionFixtureSubject } from "../../../support/reporting-category-action-fixture";

interface CategoryDetailRow {
  transactionId: string;
  merchant: string;
  amountInWon: number;
  aggregateVersion: number;
}

type ReportingAction =
  | {
      kind: "update-transaction";
      transactionId: string;
      expectedVersion: number;
      merchant: string;
      amountInWon: number;
    }
  | {
      kind: "delete-transaction";
      transactionId: string;
      expectedVersion: number;
    }
  | {
      kind: "save-merchant-rule";
      candidate: { merchant: string; categoryId: string };
    };

type UpstreamActionResult =
  | { kind: "success" }
  | { kind: "conflict"; code: string }
  | { kind: "failure"; code: string };

interface ReportingActionFixture {
  initialRows: readonly CategoryDetailRow[];
  upstreamResult: UpstreamActionResult;
  refreshedRows?: readonly CategoryDetailRow[];
}

interface ReportingActionResult {
  kind: "success" | "conflict" | "failure";
  rows: readonly CategoryDetailRow[];
  queryRevision: number;
  code?: string;
}

export interface ReportingCategoryActionsSubject {
  execute(action: ReportingAction): Promise<ReportingActionResult>;
  observedCommands(): readonly ReportingAction[];
  currentQueryRevision(): number;
}

export function createSubject(
  fixture: ReportingActionFixture,
): ReportingCategoryActionsSubject {
  return createReportingCategoryActionFixtureSubject(fixture);
}

const initialRows: readonly CategoryDetailRow[] = [
  {
    transactionId: "expense-1",
    merchant: "이전 가맹점",
    amountInWon: 10_000,
    aggregateVersion: 3,
  },
];

describe("Reporting 카테고리 상세 Action 계약", () => {
  it.each([
    {
      action: {
        kind: "update-transaction",
        transactionId: "expense-1",
        expectedVersion: 3,
        merchant: "변경 가맹점",
        amountInWon: 20_000,
      } as const,
      refreshedRows: [
        {
          transactionId: "expense-1",
          merchant: "변경 가맹점",
          amountInWon: 20_000,
          aggregateVersion: 4,
        },
      ],
    },
    {
      action: {
        kind: "delete-transaction",
        transactionId: "expense-1",
        expectedVersion: 3,
      } as const,
      refreshedRows: [],
    },
    {
      action: {
        kind: "save-merchant-rule",
        candidate: { merchant: "이전 가맹점", categoryId: "food" },
      } as const,
      refreshedRows: initialRows,
    },
  ])(
    "[T-STAT-005][STAT-004] $action.kind 성공 뒤 권위 조회 결과로 화면을 수렴시킨다",
    async ({ action, refreshedRows }) => {
      const subject = createSubject({
        initialRows,
        upstreamResult: { kind: "success" },
        refreshedRows,
      });
      const beforeRevision = subject.currentQueryRevision();

      const result = await subject.execute(action);

      expect(result).toMatchObject({
        kind: "success",
        rows: refreshedRows,
      });
      expect(result.queryRevision).toBeGreaterThan(beforeRevision);
      expect(subject.currentQueryRevision()).toBe(result.queryRevision);
      expect(subject.observedCommands()).toEqual([action]);
    },
  );

  it.each([
    { kind: "conflict", code: "TRANSACTION_VERSION_MISMATCH" },
    { kind: "failure", code: "LEDGER_UNAVAILABLE" },
  ] as const)(
    "[T-STAT-005][STAT-004] upstream $kind이면 성공처럼 화면을 바꾸거나 재조회하지 않는다",
    async (upstreamResult) => {
      const action: ReportingAction = {
        kind: "update-transaction",
        transactionId: "expense-1",
        expectedVersion: 3,
        merchant: "변경 가맹점",
        amountInWon: 20_000,
      };
      const subject = createSubject({ initialRows, upstreamResult });
      const beforeRevision = subject.currentQueryRevision();

      expect(await subject.execute(action)).toEqual({
        ...upstreamResult,
        rows: initialRows,
        queryRevision: beforeRevision,
      });
      expect(subject.currentQueryRevision()).toBe(beforeRevision);
      expect(subject.observedCommands()).toEqual([action]);
    },
  );
});
