import { describe, expect, it } from "vitest";
import { createBoundedAssetStatisticsFixtureSubject } from "../../../support/bounded-asset-statistics-fixture";

interface AssetSnapshotFact {
  snapshotId: string;
  snapshotDate: string;
  amountInWon: number;
  aggregateVersion: number;
}

interface AssetSnapshotSourcePage {
  cursor?: string;
  nextCursor?: string;
  sourceCheckpoint: string;
  items: readonly AssetSnapshotFact[];
}

type AssetSnapshotSourceResult =
  | { kind: "ready"; pages: readonly AssetSnapshotSourcePage[] }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

interface AssetStatisticsSourceRequestReceipt {
  householdId: string;
  baselineAtOrBefore: string;
  windowStartDate: string;
  windowEndDate: string;
  pageLimit: number;
}

interface AssetStatisticsResultView {
  period: { startDate: string; endDate: string };
  selectedBaseline?: AssetSnapshotFact;
  points: readonly { date: string; amountInWon: number }[];
  sourceCheckpoint: string;
  sourceRowCount: number;
}

type BoundedAssetStatisticsResult =
  | { kind: "success"; value: AssetStatisticsResultView }
  | { kind: "no-data" }
  | {
      kind: "retryable-failure";
      code: "SOURCE_WINDOW_INCOMPLETE" | string;
    }
  | {
      kind: "contract-failure";
      code: "SOURCE_CURSOR_INVALID" | string;
    };

interface BoundedAssetStatisticsFixture {
  source: AssetSnapshotSourceResult;
  maxRows: number;
  maxPages: number;
  pageLimit: number;
}

/** 자산 baseline+window 선택과 bounded cursor 완주의 공개 Query 계약입니다. */
export interface BoundedAssetStatisticsSourceSubject {
  getStatistics(input: {
    householdId: string;
    memberId: string;
    period: { startDate: string; endDate: string };
  }): Promise<BoundedAssetStatisticsResult>;
  sourceRequestReceipts(): readonly AssetStatisticsSourceRequestReceipt[];
}

export function createSubject(
  fixture: BoundedAssetStatisticsFixture,
): BoundedAssetStatisticsSourceSubject {
  return createBoundedAssetStatisticsFixtureSubject(fixture);
}

const period = { startDate: "2026-07-01", endDate: "2026-07-03" };

function snapshot(
  snapshotId: string,
  snapshotDate: string,
  amountInWon: number,
  aggregateVersion: number,
): AssetSnapshotFact {
  return { snapshotId, snapshotDate, amountInWon, aggregateVersion };
}

const facts = {
  old: snapshot("snapshot-old", "2026-06-01", 50_000, 8),
  closest: snapshot("snapshot-closest", "2026-06-30", 100_000, 9),
  july2: snapshot("snapshot-july-2", "2026-07-02", 150_000, 10),
  future: snapshot("snapshot-future", "2026-07-04", 999_000, 11),
};

function fixture(
  pages: readonly AssetSnapshotSourcePage[],
  overrides: Partial<BoundedAssetStatisticsFixture> = {},
): BoundedAssetStatisticsFixture {
  return {
    source: { kind: "ready", pages },
    maxRows: 100,
    maxPages: 10,
    pageLimit: 50,
    ...overrides,
  };
}

describe("Reporting 자산 baseline 선택·bounded pagination 계약", () => {
  it("[T-STAT-AST-001][STAT-AST-002] 여러 과거·기간·미래 후보 중 시작일 이하 가장 가까운 snapshot을 baseline으로 선택한다", async () => {
    const subject = createSubject(
      fixture([
        {
          sourceCheckpoint: "asset-window-11",
          items: [facts.old, facts.closest, facts.july2, facts.future],
        },
      ]),
    );

    const result = await subject.getStatistics({
      householdId: "house-1",
      memberId: "member-a",
      period,
    });

    expect(result).toEqual({
      kind: "success",
      value: {
        period,
        selectedBaseline: facts.closest,
        points: [
          { date: "2026-07-01", amountInWon: 100_000 },
          { date: "2026-07-02", amountInWon: 150_000 },
          { date: "2026-07-03", amountInWon: 150_000 },
        ],
        sourceCheckpoint: "asset-window-11",
        sourceRowCount: 4,
      },
    });
    expect(subject.sourceRequestReceipts()).toEqual([
      {
        householdId: "house-1",
        baselineAtOrBefore: "2026-07-01",
        windowStartDate: "2026-07-01",
        windowEndDate: "2026-07-03",
        pageLimit: 50,
      },
    ]);
  });

  it("[T-STAT-002][T-STAT-AST-001][STAT-006/STAT-AST-002] 같은 원천 사실은 단일 page와 여러 cursor page에서 동일한 결과다", async () => {
    const singlePage = createSubject(
      fixture([
        {
          sourceCheckpoint: "asset-window-11",
          items: [facts.old, facts.closest, facts.july2, facts.future],
        },
      ]),
    );
    const multiPage = createSubject(
      fixture([
        {
          sourceCheckpoint: "asset-window-11",
          nextCursor: "cursor-2",
          items: [facts.old, facts.closest],
        },
        {
          cursor: "cursor-2",
          sourceCheckpoint: "asset-window-11",
          nextCursor: "cursor-3",
          items: [facts.july2],
        },
        {
          cursor: "cursor-3",
          sourceCheckpoint: "asset-window-11",
          items: [facts.future],
        },
      ]),
    );
    const input = { householdId: "house-1", memberId: "member-a", period };

    expect(await multiPage.getStatistics(input)).toEqual(
      await singlePage.getStatistics(input),
    );
  });

  it.each([
    {
      label: "cursor 누락",
      pages: [
        {
          sourceCheckpoint: "asset-window-11",
          nextCursor: "cursor-2",
          items: [facts.closest],
        },
        {
          cursor: "cursor-3",
          sourceCheckpoint: "asset-window-11",
          items: [facts.july2],
        },
      ],
    },
    {
      label: "cursor 중복",
      pages: [
        {
          sourceCheckpoint: "asset-window-11",
          nextCursor: "cursor-2",
          items: [facts.closest],
        },
        {
          cursor: "cursor-2",
          sourceCheckpoint: "asset-window-11",
          nextCursor: "cursor-2",
          items: [facts.july2],
        },
      ],
    },
  ])(
    "[T-STAT-002][STAT-006] $label page chain은 부분 합계가 아닌 ContractFailure다",
    async ({ pages }) => {
      const subject = createSubject(fixture(pages));

      expect(
        await subject.getStatistics({
          householdId: "house-1",
          memberId: "member-a",
          period,
        }),
      ).toEqual({
        kind: "contract-failure",
        code: "SOURCE_CURSOR_INVALID",
      });
    },
  );

  it.each([
    {
      label: "page 상한",
      override: { maxPages: 1 },
    },
    {
      label: "row 상한",
      override: { maxRows: 1 },
    },
  ])(
    "[T-STAT-002][STAT-006] $label을 넘긴 asset source를 완전한 chart로 반환하지 않는다",
    async ({ override }) => {
      const subject = createSubject(
        fixture(
          [
            {
              sourceCheckpoint: "asset-window-11",
              nextCursor: "cursor-2",
              items: [facts.closest],
            },
            {
              cursor: "cursor-2",
              sourceCheckpoint: "asset-window-11",
              items: [facts.july2],
            },
          ],
          override,
        ),
      );

      expect(
        await subject.getStatistics({
          householdId: "house-1",
          memberId: "member-a",
          period,
        }),
      ).toEqual({
        kind: "retryable-failure",
        code: "SOURCE_WINDOW_INCOMPLETE",
      });
    },
  );

  it.each([
    {
      source: {
        kind: "retryable-failure",
        code: "ASSET_SNAPSHOT_REPOSITORY_UNAVAILABLE",
      } as const,
      expected: {
        kind: "retryable-failure",
        code: "ASSET_SNAPSHOT_REPOSITORY_UNAVAILABLE",
      },
    },
    {
      source: {
        kind: "contract-failure",
        code: "ASSET_SNAPSHOT_SCHEMA_CHANGED",
      } as const,
      expected: {
        kind: "contract-failure",
        code: "ASSET_SNAPSHOT_SCHEMA_CHANGED",
      },
    },
  ])(
    "[T-STAT-001][STAT-005/STAT-AST-002] asset source $source.kind를 NoData·0원 성공으로 바꾸지 않는다",
    async ({ source, expected }) => {
      const subject = createSubject({
        source,
        maxRows: 100,
        maxPages: 10,
        pageLimit: 50,
      });

      expect(
        await subject.getStatistics({
          householdId: "house-1",
          memberId: "member-a",
          period,
        }),
      ).toEqual(expected);
    },
  );
});
