import type { LedgerSearchSource } from "../ports/ledgerSearchSource";
import type {
  LedgerSearchFact,
  LedgerSearchSummary,
  SearchLedgerResult,
} from "../../domain/model/ledgerSearch";
import { matchesLedgerSearchQuery } from "../../domain/policies/ledgerSearchMatching";

export interface LedgerSearchQuery {
  search(input: {
    householdId: string;
    memberId: string;
    transactionType: "expense" | "income";
    query: string;
    period: { startDate: string; endDate: string };
    limit: number;
  }): Promise<SearchLedgerResult>;
}

function compareNewest(left: LedgerSearchFact, right: LedgerSearchFact): number {
  return (
    right.accountingDate.localeCompare(left.accountingDate) ||
    right.localTime.localeCompare(left.localTime) ||
    left.transactionId.localeCompare(right.transactionId)
  );
}

function summarize(facts: readonly LedgerSearchFact[]): LedgerSearchSummary {
  const monthly = new Map<string, { count: number; amountInWon: number }>();
  for (const fact of facts) {
    const yearMonth = fact.accountingDate.slice(0, 7);
    const current = monthly.get(yearMonth) ?? { count: 0, amountInWon: 0 };
    monthly.set(yearMonth, {
      count: current.count + 1,
      amountInWon: current.amountInWon + fact.amountInWon,
    });
  }
  return {
    totalCount: facts.length,
    totalAmountInWon: facts.reduce(
      (sum, fact) => sum + fact.amountInWon,
      0,
    ),
    monthly: [...monthly.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([yearMonth, value]) => ({ yearMonth, ...value })),
  };
}

export function createLedgerSearchQuery(input: {
  source: LedgerSearchSource;
}): LedgerSearchQuery {
  return {
    search: async (query) => {
      if (!Number.isSafeInteger(query.limit) || query.limit <= 0) {
        return { kind: "contract-failure", code: "INVALID_SEARCH_LIMIT" };
      }
      const source = await input.source.load(query);
      if (source.kind !== "ready") return source;
      const matched = source.pages
        .flatMap((page) => page)
        .filter(
          (fact) =>
            fact.householdId === query.householdId &&
            fact.transactionType === query.transactionType &&
            fact.status === "active" &&
            fact.accountingDate >= query.period.startDate &&
            fact.accountingDate <= query.period.endDate &&
            matchesLedgerSearchQuery(fact, query.query),
        )
        .sort(compareNewest);
      if (matched.length === 0) return { kind: "no-data" };
      const selected = matched.slice(0, query.limit);
      const last = selected.at(-1);
      return {
        kind: "success",
        items: selected.map((fact) => ({
          transactionId: fact.transactionId,
          accountingDate: fact.accountingDate,
          localTime: fact.localTime,
          amountInWon: fact.amountInWon,
        })),
        ...(matched.length > selected.length && last !== undefined
          ? {
              nextCursor: `${last.accountingDate}|${last.localTime}|${last.transactionId}`,
            }
          : {}),
        summary: summarize(matched),
        sourceCheckpoint: source.sourceCheckpoint,
      };
    },
  };
}
