import { describe, expect, it } from "vitest";
import { createDetailedLedgerSearchFixtureSubject } from "../../../support/detailed-ledger-search-fixture";

export interface LedgerSearchableTransaction {
  transactionId: string;
  householdId: string;
  transactionType: "expense" | "income";
  lifecycleState: "active" | "superseded" | "deleted";
  accountingDate: string;
  localTime: string;
  merchant: string;
  memo: string;
  amountInWon: number;
  cardEvidence?: {
    companyCode: string;
    standardLabel: string;
    cardType: string;
    lastFour?: string;
  };
}

export interface SearchCardDefinition {
  companyCode: string;
  aliases: readonly string[];
  cardTypeAliases: Readonly<Record<string, readonly string[]>>;
}

export type LedgerDetailedSearchResult =
  | {
      kind: "Page";
      transactionIds: readonly string[];
      nextCursor?: string;
      sourceRevision: string;
      matchedTotalCount: number;
    }
  | { kind: "NoData" }
  | {
      kind: "ValidationError";
      code: "QUERY_REQUIRED" | "INVALID_PERIOD" | "INVALID_LIMIT";
    }
  | { kind: "Conflict"; code: "CURSOR_SCOPE_MISMATCH" }
  | { kind: "RetryableFailure"; code: string };

export interface LedgerDetailedSearchContractSubject {
  search(input: {
    householdId: string;
    transactionType: "expense" | "income";
    query: string;
    period: { startDate: string; endDate: string };
    limit: number;
    cursor?: string;
  }): Promise<LedgerDetailedSearchResult>;
}

export function createSubject(fixture: {
  transactions: readonly LedgerSearchableTransaction[];
  cardDefinitions: readonly SearchCardDefinition[];
  sourceRevision: string;
}): LedgerDetailedSearchContractSubject {
  return createDetailedLedgerSearchFixtureSubject(fixture);
}

function expense(
  transactionId: string,
  overrides: Partial<LedgerSearchableTransaction> = {},
): LedgerSearchableTransaction {
  return {
    transactionId,
    householdId: "household-1",
    transactionType: "expense",
    lifecycleState: "active",
    accountingDate: "2026-07-20",
    localTime: "12:00",
    merchant: "가맹점",
    memo: "",
    amountInWon: 10_000,
    ...overrides,
  };
}

const cardDefinitions: readonly SearchCardDefinition[] = [
  {
    companyCode: "kb",
    aliases: ["국민", "국민카드", "KB"],
    cardTypeAliases: { credit: ["신용", "신용카드"] },
  },
  {
    companyCode: "samsung",
    aliases: ["삼성", "삼성카드"],
    cardTypeAliases: { credit: ["신용", "신용카드"] },
  },
  {
    companyCode: "new-provider",
    aliases: ["새카드", "새로운결제"],
    cardTypeAliases: { wallet: ["간편결제"] },
  },
];

const searchable = [
  expense("merchant-match", {
    accountingDate: "2026-07-22",
    localTime: "09:30",
    merchant: "StarBucks  강남점",
    cardEvidence: {
      companyCode: "kb",
      standardLabel: "국민카드",
      cardType: "credit",
      lastFour: "2972",
    },
  }),
  expense("memo-match", {
    accountingDate: "2026-07-21",
    memo: "아이 병원 진료비",
    cardEvidence: {
      companyCode: "kb",
      standardLabel: "국민카드",
      cardType: "credit",
      lastFour: "1234",
    },
  }),
  expense("samsung-match", {
    accountingDate: "2026-07-20",
    cardEvidence: {
      companyCode: "samsung",
      standardLabel: "삼성카드",
      cardType: "credit",
      lastFour: "3123",
    },
  }),
  expense("new-provider-match", {
    accountingDate: "2026-07-19",
    cardEvidence: {
      companyCode: "new-provider",
      standardLabel: "새카드",
      cardType: "wallet",
      lastFour: "7777",
    },
  }),
];

const baseQuery = {
  householdId: "household-1",
  transactionType: "expense" as const,
  period: { startDate: "2026-07-01", endDate: "2026-07-31" },
  limit: 20,
};

describe("Ledger 검색어 변형·정렬·기간·cursor 공개 계약", () => {
  it.each([
    { query: " starbucks 강남 ", expected: ["merchant-match"] },
    { query: "병원 진료", expected: ["memo-match"] },
    {
      query: "국민카드",
      expected: ["merchant-match", "memo-match"],
    },
    { query: "KB", expected: ["merchant-match", "memo-match"] },
    { query: "2972", expected: ["merchant-match"] },
    { query: "국민카드(2972)", expected: ["merchant-match"] },
    { query: "국민카드(2***)", expected: ["merchant-match"] },
    { query: "삼성카드(3xxx)", expected: ["samsung-match"] },
    {
      query: "신용카드",
      expected: ["merchant-match", "memo-match", "samsung-match"],
    },
    { query: "새로운결제", expected: ["new-provider-match"] },
    { query: "간편결제", expected: ["new-provider-match"] },
  ])(
    "[T-SEA-001][SEA-001/SEA-002] '$query'를 가맹점·메모·보존 카드 증거와 설정 기반 alias로 검색한다",
    async ({ query, expected }) => {
      const result = await createSubject({
        transactions: searchable,
        cardDefinitions,
        sourceRevision: "ledger-r1",
      }).search({ ...baseQuery, query });

      expect(result).toMatchObject({
        kind: "Page",
        transactionIds: expected,
        matchedTotalCount: expected.length,
      });
    },
  );

  it("[T-SEA-001][SEA-002] 카드사와 번호를 함께 쓴 검색은 둘 중 하나만 맞는 거래를 포함하지 않는다", async () => {
    const result = await createSubject({
      transactions: searchable,
      cardDefinitions,
      sourceRevision: "ledger-r1",
    }).search({ ...baseQuery, query: "국민카드(3123)" });

    expect(result).toEqual({ kind: "NoData" });
  });

  it("[T-SEA-001][SEA-001] 결과는 기간 양끝을 포함하고 날짜·시각·ID 내림차순이며 가구·유형·active 범위만 반환한다", async () => {
    const rows = [
      expense("start", { accountingDate: "2026-07-10", merchant: "공통" }),
      expense("same-a", {
        accountingDate: "2026-07-20",
        localTime: "13:00",
        merchant: "공통",
      }),
      expense("same-c", {
        accountingDate: "2026-07-20",
        localTime: "13:00",
        merchant: "공통",
      }),
      expense("end", { accountingDate: "2026-07-21", merchant: "공통" }),
      expense("before", { accountingDate: "2026-07-09", merchant: "공통" }),
      expense("after", { accountingDate: "2026-07-22", merchant: "공통" }),
      expense("income", { transactionType: "income", merchant: "공통" }),
      expense("other-house", {
        householdId: "household-2",
        merchant: "공통",
      }),
      expense("superseded", {
        lifecycleState: "superseded",
        merchant: "공통",
      }),
    ];

    const result = await createSubject({
      transactions: rows,
      cardDefinitions,
      sourceRevision: "ledger-r2",
    }).search({
      ...baseQuery,
      query: "공통",
      period: { startDate: "2026-07-10", endDate: "2026-07-21" },
    });

    expect(result).toMatchObject({
      kind: "Page",
      transactionIds: ["end", "same-c", "same-a", "start"],
    });
  });

  it.each(["", "   "])(
    "[T-SEA-001][SEA-001] 빈 검색어 '%s'는 전체 원장 조회로 바꾸지 않고 NoData를 반환한다",
    async (query) => {
      expect(
        await createSubject({
          transactions: searchable,
          cardDefinitions,
          sourceRevision: "ledger-r1",
        }).search({ ...baseQuery, query }),
      ).toEqual({ kind: "NoData" });
    },
  );

  it("[T-SEA-002][SEA-003] opaque cursor paging은 중복·누락 없이 다음 page를 반환하고 scope를 고정한다", async () => {
    const subject = createSubject({
      transactions: searchable,
      cardDefinitions,
      sourceRevision: "ledger-r3",
    });

    const first = await subject.search({ ...baseQuery, query: "신용", limit: 2 });
    expect(first).toMatchObject({
      kind: "Page",
      transactionIds: ["merchant-match", "memo-match"],
      nextCursor: expect.any(String),
      matchedTotalCount: 3,
    });
    const cursor = first.kind === "Page" ? first.nextCursor : undefined;
    const second = await subject.search({
      ...baseQuery,
      query: "신용",
      limit: 2,
      cursor,
    });
    expect(second).toEqual({
      kind: "Page",
      transactionIds: ["samsung-match"],
      sourceRevision: "ledger-r3",
      matchedTotalCount: 3,
    });

    expect(
      await subject.search({
        ...baseQuery,
        query: "국민",
        limit: 2,
        cursor,
      }),
    ).toEqual({ kind: "Conflict", code: "CURSOR_SCOPE_MISMATCH" });
  });
});
