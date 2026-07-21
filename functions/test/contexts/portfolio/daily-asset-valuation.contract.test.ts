import { describe, expect, it } from "vitest";
import { createDailyAssetValuationFixture } from "../../support/daily-asset-valuation-fixture";

type ValuationMarket =
  | "KRX"
  | "US"
  | "KOFIA_FUND"
  | "UPBIT_KRW"
  | "PHYSICAL_GOLD";

interface ValuationTarget {
  targetId: string;
  assetId: string;
  market: ValuationMarket;
  assetType: string;
  ownerRefKey: string;
  previousSuccessfulValue: number;
  providerResult:
    | { kind: "success"; valueInWon: number }
    | { kind: "retryable-failure"; code: string };
}

interface DailyValuationRunView {
  kind: "complete" | "partial-failure";
  runId: string;
  createdAt: string;
  completed: true;
  pageReceipts: readonly {
    pageNumber: number;
    targetIds: readonly string[];
    terminal: true;
  }[];
  succeeded: readonly string[];
  retryableFailed: readonly {
    targetId: string;
    code: string;
    retainedValueInWon: number;
  }[];
  maxObservedProviderConcurrency: number;
  snapshotProjectionStatus: "queued" | "up-to-date";
}

interface AssetSnapshotIntentView {
  localDate: string;
  total: number;
  financial: number;
  byType: Readonly<Record<string, number>>;
  byOwnerRefKey: Readonly<Record<string, number>>;
  createdAt: string;
}

interface AssetValuationChangedEvent {
  eventType: "AssetValuationChanged.v1";
  assetId: string;
  currentSignedBalance: number;
}

interface DailyAssetValuationSeed {
  targets: readonly ValuationTarget[];
  previousSnapshotScopes?: {
    byType: Readonly<Record<string, number>>;
    byOwnerRefKey: Readonly<Record<string, number>>;
  };
  fixedCreatedAt: string;
}

/** 페이지 진입·23:55 전체 평가와 Snapshot 요청의 공개 Workflow 계약입니다. */
export interface DailyAssetValuationSubject {
  run(input: {
    trigger: "asset-page-entry" | "daily-23:55";
    householdId?: string;
    requestedAt: string;
    asOfDate: string;
    idempotencyKey?: string;
  }): Promise<DailyValuationRunView>;
  listRuns(): readonly DailyValuationRunView[];
  currentAssetValues(): Readonly<Record<string, number>>;
  snapshotIntent(localDate: string): AssetSnapshotIntentView | undefined;
  recordedEvents(): readonly AssetValuationChangedEvent[];
}

export function createSubject(
  seed: DailyAssetValuationSeed,
): DailyAssetValuationSubject {
  return createDailyAssetValuationFixture(seed);
}

function buildTargets(count: number): ValuationTarget[] {
  const markets: readonly ValuationMarket[] = [
    "KRX",
    "US",
    "KOFIA_FUND",
    "UPBIT_KRW",
    "PHYSICAL_GOLD",
  ];

  return Array.from({ length: count }, (_, index) => ({
    targetId: `target-${String(index + 1).padStart(3, "0")}`,
    assetId: `asset-${String(index + 1).padStart(3, "0")}`,
    market: markets[index % markets.length],
    assetType:
      index % markets.length === 2
        ? "fund"
        : index % markets.length === 3
          ? "crypto"
          : index % markets.length === 4
            ? "gold"
            : "stock",
    ownerRefKey: "household",
    previousSuccessfulValue: 500 + index,
    providerResult: { kind: "success", valueInWon: 1_000 + index },
  }));
}

describe("전체 자산 시세 갱신과 Snapshot 요청 계약", () => {
  it("[T-JOB-AST-001][JOB-AST-001/JOB-AST-002/DEC-049] 101개 다중 시장 target을 50개 page·병렬 5 이하로 모두 terminal 처리한 뒤 Snapshot을 요청한다", async () => {
    const targets = buildTargets(101);
    targets[100] = {
      ...targets[100],
      providerResult: {
        kind: "retryable-failure",
        code: "MARKET_TIMEOUT",
      },
    };
    const subject = createSubject({
      targets,
      previousSnapshotScopes: {
        byType: { bond: 50_000 },
        byOwnerRefKey: { "profile:archived-owner": 50_000 },
      },
      fixedCreatedAt: "2026-07-20T14:55:00.000Z",
    });

    const result = await subject.run({
      trigger: "daily-23:55",
      requestedAt: "2026-07-20T23:55:00+09:00",
      asOfDate: "2026-07-20",
      idempotencyKey: "daily-assets:2026-07-20",
    });

    expect(result.kind).toBe("partial-failure");
    expect(result.completed).toBe(true);
    expect(result.pageReceipts.map(({ targetIds }) => targetIds.length)).toEqual([
      50, 50, 1,
    ]);
    expect(result.pageReceipts.flatMap(({ targetIds }) => targetIds)).toEqual(
      targets.map(({ targetId }) => targetId),
    );
    expect(result.maxObservedProviderConcurrency).toBeLessThanOrEqual(5);
    expect(result.retryableFailed).toEqual([
      {
        targetId: "target-101",
        code: "MARKET_TIMEOUT",
        retainedValueInWon: targets[100].previousSuccessfulValue,
      },
    ]);
    expect(result.snapshotProjectionStatus).toBe("queued");

    const expectedValues = targets.map((target) =>
      target.providerResult.kind === "success"
        ? target.providerResult.valueInWon
        : target.previousSuccessfulValue,
    );
    const expectedTotal = expectedValues.reduce(
      (total, value) => total + value,
      0,
    );
    expect(subject.currentAssetValues()["asset-101"]).toBe(
      targets[100].previousSuccessfulValue,
    );
    expect(subject.snapshotIntent("2026-07-20")).toEqual(
      expect.objectContaining({
        localDate: "2026-07-20",
        total: expectedTotal,
        byType: expect.objectContaining({ bond: 0 }),
        byOwnerRefKey: expect.objectContaining({
          "profile:archived-owner": 0,
        }),
      }),
    );
    expect(subject.recordedEvents().map(({ assetId }) => assetId)).toEqual(
      targets
        .filter(({ providerResult }) => providerResult.kind === "success")
        .map(({ assetId }) => assetId),
    );
  });

  it("[T-JOB-AST-001][JOB-AST-001] 같은 날짜·idempotency key 재실행은 같은 run과 Snapshot createdAt을 재생한다", async () => {
    const subject = createSubject({
      targets: buildTargets(3),
      fixedCreatedAt: "2026-07-20T14:55:00.000Z",
    });
    const input = {
      trigger: "daily-23:55" as const,
      requestedAt: "2026-07-20T23:55:00+09:00",
      asOfDate: "2026-07-20",
      idempotencyKey: "daily-assets:2026-07-20",
    };

    const first = await subject.run(input);
    const firstSnapshot = subject.snapshotIntent("2026-07-20");
    const replay = await subject.run(input);

    expect(replay).toEqual(first);
    expect(subject.listRuns()).toEqual([first]);
    expect(subject.snapshotIntent("2026-07-20")).toEqual(firstSnapshot);
    expect(firstSnapshot?.createdAt).toBe("2026-07-20T14:55:00.000Z");
    expect(subject.recordedEvents()).toHaveLength(3);
  });

  it("[T-JOB-AST-001][JOB-AST-001/DEC-049] 같은 가구 자산 페이지의 30초 내 중복 요청은 하나의 전체 refresh run 결과를 공유한다", async () => {
    const subject = createSubject({
      targets: buildTargets(55),
      fixedCreatedAt: "2026-07-20T03:00:00.000Z",
    });

    const first = await subject.run({
      trigger: "asset-page-entry",
      householdId: "house-1",
      requestedAt: "2026-07-20T12:00:00+09:00",
      asOfDate: "2026-07-20",
    });
    const duplicate = await subject.run({
      trigger: "asset-page-entry",
      householdId: "house-1",
      requestedAt: "2026-07-20T12:00:20+09:00",
      asOfDate: "2026-07-20",
    });

    expect(duplicate).toEqual(first);
    expect(subject.listRuns()).toEqual([first]);
    expect(first.pageReceipts.map(({ targetIds }) => targetIds.length)).toEqual([
      50, 5,
    ]);
    expect(first.completed).toBe(true);
  });
});
