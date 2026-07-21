import type { BoundedAssetSnapshotSourcePort } from "../ports/boundedAssetSnapshotSource";
import type {
  AssetSnapshotFact,
  AssetSnapshotSourcePage,
  BoundedAssetStatisticsResult,
} from "../../model/boundedAssetStatistics";

export interface BoundedAssetStatisticsQuery {
  getStatistics(input: {
    householdId: string;
    memberId: string;
    period: { startDate: string; endDate: string };
  }): Promise<BoundedAssetStatisticsResult>;
}

type CompleteWindowResult =
  | {
      kind: "success";
      facts: readonly AssetSnapshotFact[];
      sourceCheckpoint: string;
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: "SOURCE_WINDOW_INCOMPLETE" }
  | { kind: "contract-failure"; code: "SOURCE_CURSOR_INVALID" };

function collectCompleteWindow(
  pages: readonly AssetSnapshotSourcePage[],
  limits: { maxRows: number; maxPages: number },
): CompleteWindowResult {
  if (pages.length === 0) return { kind: "no-data" };
  if (pages.length > limits.maxPages) {
    return { kind: "retryable-failure", code: "SOURCE_WINDOW_INCOMPLETE" };
  }

  const sourceCheckpoint = pages[0].sourceCheckpoint;
  if (sourceCheckpoint.length === 0) {
    return { kind: "retryable-failure", code: "SOURCE_WINDOW_INCOMPLETE" };
  }

  const consumedCursors = new Set<string>();
  let expectedCursor: string | undefined;
  let rowCount = 0;
  const facts: AssetSnapshotFact[] = [];

  for (const page of pages) {
    if (page.cursor !== expectedCursor) {
      return { kind: "contract-failure", code: "SOURCE_CURSOR_INVALID" };
    }
    if (page.cursor !== undefined) {
      if (consumedCursors.has(page.cursor)) {
        return { kind: "contract-failure", code: "SOURCE_CURSOR_INVALID" };
      }
      consumedCursors.add(page.cursor);
    }
    if (
      page.nextCursor !== undefined &&
      (page.nextCursor === page.cursor || consumedCursors.has(page.nextCursor))
    ) {
      return { kind: "contract-failure", code: "SOURCE_CURSOR_INVALID" };
    }
    if (page.sourceCheckpoint !== sourceCheckpoint) {
      return { kind: "retryable-failure", code: "SOURCE_WINDOW_INCOMPLETE" };
    }

    rowCount += page.items.length;
    if (rowCount > limits.maxRows) {
      return { kind: "retryable-failure", code: "SOURCE_WINDOW_INCOMPLETE" };
    }
    facts.push(...page.items);
    expectedCursor = page.nextCursor;
  }

  if (expectedCursor !== undefined) {
    return { kind: "retryable-failure", code: "SOURCE_WINDOW_INCOMPLETE" };
  }
  return { kind: "success", facts, sourceCheckpoint };
}

function eachDate(startDate: string, endDate: string): readonly string[] {
  const result: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function compareSnapshots(
  left: AssetSnapshotFact,
  right: AssetSnapshotFact,
): number {
  return (
    left.snapshotDate.localeCompare(right.snapshotDate) ||
    left.aggregateVersion - right.aggregateVersion ||
    left.snapshotId.localeCompare(right.snapshotId)
  );
}

export function createBoundedAssetStatisticsQuery(input: {
  source: BoundedAssetSnapshotSourcePort;
  maxRows: number;
  maxPages: number;
  pageLimit: number;
}): BoundedAssetStatisticsQuery {
  return {
    getStatistics: async ({ householdId, memberId, period }) => {
      const sourceResult = await input.source.load({
        householdId,
        memberId,
        baselineAtOrBefore: period.startDate,
        windowStartDate: period.startDate,
        windowEndDate: period.endDate,
        pageLimit: input.pageLimit,
      });
      if (sourceResult.kind !== "ready") return sourceResult;

      const complete = collectCompleteWindow(sourceResult.pages, input);
      if (complete.kind !== "success") return complete;

      const sorted = [...complete.facts].sort(compareSnapshots);
      const selectedBaseline = sorted
        .filter((fact) => fact.snapshotDate <= period.startDate)
        .at(-1);
      const periodFacts = sorted.filter(
        (fact) =>
          fact.snapshotDate > period.startDate &&
          fact.snapshotDate <= period.endDate,
      );

      let amount = selectedBaseline?.amountInWon;
      const factsByDate = new Map<string, AssetSnapshotFact>();
      for (const fact of periodFacts) factsByDate.set(fact.snapshotDate, fact);
      const points: { date: string; amountInWon: number }[] = [];
      for (const date of eachDate(period.startDate, period.endDate)) {
        amount = factsByDate.get(date)?.amountInWon ?? amount;
        if (amount !== undefined) points.push({ date, amountInWon: amount });
      }

      if (selectedBaseline === undefined && points.length === 0) {
        return { kind: "no-data" };
      }
      return {
        kind: "success",
        value: {
          period,
          ...(selectedBaseline === undefined ? {} : { selectedBaseline }),
          points,
          sourceCheckpoint: complete.sourceCheckpoint,
          sourceRowCount: complete.facts.length,
        },
      };
    },
  };
}
