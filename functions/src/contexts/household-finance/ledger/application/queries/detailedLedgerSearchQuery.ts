import type {
  DetailedLedgerSearchSource,
  SearchCursorIssuer,
} from "../ports/detailedLedgerSearchSource";
import type { LedgerDetailedSearchResult } from "../../domain/model/detailedLedgerSearch";
import { matchesDetailedLedgerSearch } from "../../domain/policies/detailedLedgerSearchMatching";
import { normalizedSearchText } from "../../domain/policies/ledgerSearchMatching";

export interface DetailedLedgerSearchQuery {
  search(input: {
    householdId: string;
    transactionType: "expense" | "income";
    query: string;
    period: { startDate: string; endDate: string };
    limit: number;
    cursor?: string;
  }): Promise<LedgerDetailedSearchResult>;
}

interface CursorState {
  scope: string;
  sourceRevision: string;
  offset: number;
}

function scopeOf(input: {
  householdId: string;
  transactionType: "expense" | "income";
  query: string;
  period: { startDate: string; endDate: string };
  limit: number;
}): string {
  return JSON.stringify({
    householdId: input.householdId,
    transactionType: input.transactionType,
    query: normalizedSearchText(input.query),
    period: input.period,
    limit: input.limit,
  });
}

export function createDetailedLedgerSearchQuery(input: {
  source: DetailedLedgerSearchSource;
  cursorIssuer: SearchCursorIssuer;
}): DetailedLedgerSearchQuery {
  const cursors = new Map<string, CursorState>();
  return {
    search: async (query) => {
      if (query.period.startDate > query.period.endDate) {
        return { kind: "ValidationError", code: "INVALID_PERIOD" };
      }
      if (!Number.isSafeInteger(query.limit) || query.limit <= 0) {
        return { kind: "ValidationError", code: "INVALID_LIMIT" };
      }
      if (normalizedSearchText(query.query).length === 0) {
        return { kind: "NoData" };
      }
      const source = await input.source.load();
      if (source.kind !== "ready") return source;

      const scope = scopeOf(query);
      let offset = 0;
      if (query.cursor !== undefined) {
        const cursor = cursors.get(query.cursor);
        if (
          cursor === undefined ||
          cursor.scope !== scope ||
          cursor.sourceRevision !== source.sourceRevision
        ) {
          return { kind: "Conflict", code: "CURSOR_SCOPE_MISMATCH" };
        }
        offset = cursor.offset;
      }

      const matched = source.transactions
        .filter(
          (transaction) =>
            transaction.householdId === query.householdId &&
            transaction.transactionType === query.transactionType &&
            transaction.lifecycleState === "active" &&
            transaction.accountingDate >= query.period.startDate &&
            transaction.accountingDate <= query.period.endDate &&
            matchesDetailedLedgerSearch({
              transaction,
              query: query.query,
              definitions: source.cardDefinitions,
            }),
        )
        .sort(
          (left, right) =>
            right.accountingDate.localeCompare(left.accountingDate) ||
            right.localTime.localeCompare(left.localTime) ||
            right.transactionId.localeCompare(left.transactionId),
        );
      if (matched.length === 0 || offset >= matched.length) {
        return { kind: "NoData" };
      }
      const page = matched.slice(offset, offset + query.limit);
      let nextCursor: string | undefined;
      if (offset + page.length < matched.length) {
        nextCursor = input.cursorIssuer.next();
        cursors.set(nextCursor, {
          scope,
          sourceRevision: source.sourceRevision,
          offset: offset + page.length,
        });
      }
      return {
        kind: "Page",
        transactionIds: page.map((transaction) => transaction.transactionId),
        ...(nextCursor === undefined ? {} : { nextCursor }),
        sourceRevision: source.sourceRevision,
        matchedTotalCount: matched.length,
      };
    },
  };
}
