import { describe, expect, it } from "vitest";
import { createLedgerSearchFixtureSubject } from "../../../support/ledger-search-fixture";

type TransactionType = "expense" | "income";
type TransactionStatus = "active" | "cancelled" | "deleted" | "superseded";

interface LedgerSearchFact {
  transactionId: string;
  householdId: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  accountingDate: string;
  localTime: string;
  merchant: string;
  memo: string;
  amountInWon: number;
  cardEvidence?: {
    companyCode: string;
    companyLabel: string;
    lastFour?: string;
  };
}

type LedgerSearchSourceFixture =
  | {
      kind: "ready";
      sourceCheckpoint: string;
      pages: ReadonlyArray<readonly LedgerSearchFact[]>;
    }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

interface LedgerSearchItem {
  transactionId: string;
  accountingDate: string;
  localTime: string;
  amountInWon: number;
}

interface LedgerSearchSummary {
  totalCount: number;
  totalAmountInWon: number;
  monthly: ReadonlyArray<{
    yearMonth: string;
    count: number;
    amountInWon: number;
  }>;
}

type SearchLedgerResult =
  | {
      kind: "success";
      items: readonly LedgerSearchItem[];
      nextCursor?: string;
      summary: LedgerSearchSummary;
      sourceCheckpoint: string;
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

export interface LedgerSearchContractSubject {
  search(input: {
    householdId: string;
    memberId: string;
    transactionType: TransactionType;
    query: string;
    period: { startDate: string; endDate: string };
    limit: number;
  }): Promise<SearchLedgerResult>;
}

export function createSubject(
  source: LedgerSearchSourceFixture,
): LedgerSearchContractSubject {
  return createLedgerSearchFixtureSubject(source);
}

const expense = (
  transactionId: string,
  overrides: Partial<LedgerSearchFact> = {},
): LedgerSearchFact => ({
  transactionId,
  householdId: "house-1",
  transactionType: "expense",
  status: "active",
  accountingDate: "2026-07-10",
  localTime: "12:00",
  merchant: "가맹점",
  memo: "",
  amountInWon: 10_000,
  ...overrides,
});

const query = {
  householdId: "house-1",
  memberId: "member-a",
  transactionType: "expense" as const,
  query: "삼성카드(3***)",
  period: { startDate: "2026-06-01", endDate: "2026-07-31" },
  limit: 1,
};

describe("Ledger 검색 공개 계약", () => {
  it("[T-SEA-001][T-SEA-003][SEA-002/SEA-004] 카드사 별칭과 마스킹 번호를 모두 만족한 전체 결과의 총·월별 합계를 반환한다", async () => {
    const subject = createSubject({
      kind: "ready",
      sourceCheckpoint: "ledger-v17",
      pages: [
        [
          expense("samsung-july", {
            accountingDate: "2026-07-11",
            amountInWon: 30_000,
            cardEvidence: {
              companyCode: "samsung",
              companyLabel: "삼성",
              lastFour: "3123",
            },
          }),
          expense("other-company", {
            amountInWon: 90_000,
            cardEvidence: {
              companyCode: "kb",
              companyLabel: "국민",
              lastFour: "3456",
            },
          }),
        ],
        [
          expense("samsung-june-1", {
            accountingDate: "2026-06-20",
            amountInWon: 20_000,
            cardEvidence: {
              companyCode: "samsung",
              companyLabel: "삼성",
              lastFour: "3987",
            },
          }),
          expense("samsung-june-2", {
            accountingDate: "2026-06-03",
            amountInWon: 10_000,
            cardEvidence: {
              companyCode: "samsung",
              companyLabel: "삼성",
              lastFour: "3001",
            },
          }),
          expense("wrong-prefix", {
            amountInWon: 80_000,
            cardEvidence: {
              companyCode: "samsung",
              companyLabel: "삼성",
              lastFour: "4123",
            },
          }),
        ],
      ],
    });

    const result = await subject.search(query);

    expect(result).toEqual({
      kind: "success",
      items: [
        {
          transactionId: "samsung-july",
          accountingDate: "2026-07-11",
          localTime: "12:00",
          amountInWon: 30_000,
        },
      ],
      nextCursor: expect.any(String),
      summary: {
        totalCount: 3,
        totalAmountInWon: 60_000,
        monthly: [
          { yearMonth: "2026-07", count: 1, amountInWon: 30_000 },
          { yearMonth: "2026-06", count: 2, amountInWon: 30_000 },
        ],
      },
      sourceCheckpoint: "ledger-v17",
    });
  });

  it("[T-SEA-001] 다른 가구·거래 유형·비활성 거래를 제외하고 가맹점·메모·카드 증거만 검색한다", async () => {
    const subject = createSubject({
      kind: "ready",
      sourceCheckpoint: "ledger-v18",
      pages: [
        [
          expense("matched-by-card", {
            cardEvidence: {
              companyCode: "kb",
              companyLabel: "국민",
              lastFour: "2972",
            },
          }),
          expense("other-household", {
            householdId: "house-2",
            cardEvidence: {
              companyCode: "kb",
              companyLabel: "국민",
              lastFour: "2972",
            },
          }),
          expense("income", {
            transactionType: "income",
            cardEvidence: {
              companyCode: "kb",
              companyLabel: "국민",
              lastFour: "2972",
            },
          }),
          expense("deleted", {
            status: "deleted",
            cardEvidence: {
              companyCode: "kb",
              companyLabel: "국민",
              lastFour: "2972",
            },
          }),
        ],
      ],
    });

    const result = await subject.search({
      ...query,
      query: "국민카드(2972)",
      limit: 20,
    });

    expect(result).toMatchObject({
      kind: "success",
      items: [{ transactionId: "matched-by-card" }],
      summary: { totalCount: 1, totalAmountInWon: 10_000 },
    });
  });

  it.each([
    ["retryable-failure", "SEARCH_SOURCE_WINDOW_CHANGED"],
    ["contract-failure", "SEARCH_SOURCE_LIMIT_EXCEEDED"],
  ] as const)(
    "[T-SEA-003] 전체 검색 집계를 완료하지 못한 %s를 page 부분 합계 성공으로 바꾸지 않는다",
    async (kind, code) => {
      const result = await createSubject({ kind, code }).search(query);

      expect(result).toEqual({ kind, code });
    },
  );
});
