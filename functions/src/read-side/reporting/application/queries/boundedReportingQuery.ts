import type { BoundedLedgerSourcePort } from "../ports/boundedLedgerSource";
import type {
  BoundedReportingResult,
  BoundedReportingView,
  LedgerSourcePage,
  ReportingRequestIdentity,
} from "../../model/boundedReporting";

export interface BoundedReportingQuery {
  load(input: {
    identity: ReportingRequestIdentity;
    period: { startDate: string; endDate: string };
  }): Promise<BoundedReportingResult>;
  currentView(): BoundedReportingView | undefined;
  clearActorSession(nextSessionGeneration: string): void;
}

function sameIdentity(
  left: ReportingRequestIdentity | undefined,
  right: ReportingRequestIdentity,
): boolean {
  return (
    left?.actorSessionGeneration === right.actorSessionGeneration &&
    left.householdId === right.householdId &&
    left.queryKey === right.queryKey &&
    left.queryRevision === right.queryRevision
  );
}

function completeWindow(
  pages: readonly LedgerSourcePage[],
  maxRows: number,
  maxPages: number,
):
  | { kind: "success"; checkpoint: string; rowCount: number; total: number }
  | { kind: "retryable-failure"; code: "SOURCE_WINDOW_INCOMPLETE" } {
  if (pages.length === 0 || pages.length > maxPages) {
    return { kind: "retryable-failure", code: "SOURCE_WINDOW_INCOMPLETE" };
  }

  const checkpoint = pages[0].sourceCheckpoint;
  let expectedCursor: string | undefined;
  let rowCount = 0;
  let total = 0;
  for (const page of pages) {
    if (
      page.cursor !== expectedCursor ||
      page.sourceCheckpoint !== checkpoint ||
      checkpoint.length === 0
    ) {
      return { kind: "retryable-failure", code: "SOURCE_WINDOW_INCOMPLETE" };
    }
    rowCount += page.items.length;
    if (rowCount > maxRows) {
      return { kind: "retryable-failure", code: "SOURCE_WINDOW_INCOMPLETE" };
    }
    total += page.items.reduce(
      (sum, item) =>
        item.transactionType === "expense" ? sum + item.amountInWon : sum,
      0,
    );
    expectedCursor = page.nextCursor;
  }
  if (expectedCursor !== undefined) {
    return { kind: "retryable-failure", code: "SOURCE_WINDOW_INCOMPLETE" };
  }
  return { kind: "success", checkpoint, rowCount, total };
}

export function createBoundedReportingQuery(
  source: BoundedLedgerSourcePort,
  limits: { maxRows: number; maxPages: number },
): BoundedReportingQuery {
  let view: BoundedReportingView | undefined;
  let activeIdentity: ReportingRequestIdentity | undefined;
  let sessionGeneration: string | undefined;

  return {
    load: async (input) => {
      if (sessionGeneration === undefined) {
        sessionGeneration = input.identity.actorSessionGeneration;
      }
      activeIdentity = input.identity;
      const sourceResult = await source.load(input);
      if (sourceResult.kind !== "ready") return sourceResult;

      const complete = completeWindow(
        sourceResult.pages,
        limits.maxRows,
        limits.maxPages,
      );
      if (complete.kind !== "success") return complete;

      const value: BoundedReportingView = {
        identity: input.identity,
        totalExpenseInWon: complete.total,
        sourceCheckpoint: complete.checkpoint,
        rowCount: complete.rowCount,
      };
      if (
        sessionGeneration === input.identity.actorSessionGeneration &&
        sameIdentity(activeIdentity, input.identity)
      ) {
        view = value;
      }
      return { kind: "success", value };
    },
    currentView: () => view,
    clearActorSession: (nextSessionGeneration) => {
      sessionGeneration = nextSessionGeneration;
      activeIdentity = undefined;
      view = undefined;
    },
  };
}
