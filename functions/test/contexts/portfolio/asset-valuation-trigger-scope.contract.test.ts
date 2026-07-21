import { describe, expect, it } from "vitest";
import { createAssetValuationTriggerScopeFixture } from "../../support/asset-valuation-trigger-scope-fixture";

interface ValuationHousehold {
  householdId: string;
  lifecycle: "active" | "deleted";
}

interface ScopedValuationTarget {
  targetId: string;
  householdId: string;
  assetId: string;
  assetLifecycle: "active" | "deleted" | "purging";
  market: "KRX" | "US" | "KOFIA_FUND" | "UPBIT_KRW" | "PHYSICAL_GOLD";
  previousValueInWon: number;
  providerResult:
    | { kind: "success"; valueInWon: number }
    | { kind: "retryable-failure"; code: string };
}

interface ValuationChildReceipt {
  childKey: string;
  runId: string;
  householdId: string;
  assetId: string;
  outcome: "succeeded" | "retained-last-success";
  resultingValueInWon: number;
}

interface ScopedValuationRunResult {
  kind: "complete" | "partial-failure" | "interrupted";
  runId: string;
  trigger: "manual-asset" | "asset-page-entry" | "daily-23:55";
  householdIds: readonly string[];
  processedTargetIds: readonly string[];
  pageReceipts: readonly {
    pageNumber: number;
    targetIds: readonly string[];
    terminal: true;
    checkpointAfter?: string;
  }[];
  retryableFailures: readonly { targetId: string; code: string }[];
  snapshotRequestedForHouseholdIds: readonly string[];
  checkpoint?: string;
}

interface AssetValuationTriggerScopeFixture {
  households: readonly ValuationHousehold[];
  targets: readonly ScopedValuationTarget[];
  pageSize?: number;
  interruptAfterPage?: number;
}

/** 수동 단건·페이지 진입·23:55 전체 평가의 대상 범위 계약입니다. */
export interface AssetValuationTriggerScopeSubject {
  refreshSingleAsset(input: {
    actorHouseholdId: string;
    assetId: string;
    requestedAt: string;
    idempotencyKey: string;
  }): Promise<ScopedValuationRunResult>;
  refreshHouseholdOnPageEntry(input: {
    actorHouseholdId: string;
    requestedAt: string;
  }): Promise<ScopedValuationRunResult>;
  runDailyValuation(input: {
    occurrenceId: string;
    scheduledFor: string;
    asOfDate: string;
    resumeFromCheckpoint?: string;
  }): Promise<ScopedValuationRunResult>;
  currentAssetValues(): Readonly<Record<string, number>>;
  childReceipts(): readonly ValuationChildReceipt[];
  listRuns(): readonly ScopedValuationRunResult[];
}

export function createSubject(
  fixture: AssetValuationTriggerScopeFixture,
): AssetValuationTriggerScopeSubject {
  return createAssetValuationTriggerScopeFixture(fixture);
}

const households: readonly ValuationHousehold[] = [
  { householdId: "house-a", lifecycle: "active" },
  { householdId: "house-b", lifecycle: "active" },
  { householdId: "house-deleted", lifecycle: "deleted" },
];

const targets: readonly ScopedValuationTarget[] = [
  {
    targetId: "target-a-stock",
    householdId: "house-a",
    assetId: "asset-a-stock",
    assetLifecycle: "active",
    market: "KRX",
    previousValueInWon: 90,
    providerResult: { kind: "success", valueInWon: 100 },
  },
  {
    targetId: "target-a-deleted",
    householdId: "house-a",
    assetId: "asset-a-deleted",
    assetLifecycle: "deleted",
    market: "US",
    previousValueInWon: 190,
    providerResult: { kind: "success", valueInWon: 200 },
  },
  {
    targetId: "target-b-fund",
    householdId: "house-b",
    assetId: "asset-b-fund",
    assetLifecycle: "active",
    market: "KOFIA_FUND",
    previousValueInWon: 290,
    providerResult: { kind: "success", valueInWon: 300 },
  },
  {
    targetId: "target-deleted-house-gold",
    householdId: "house-deleted",
    assetId: "asset-deleted-house-gold",
    assetLifecycle: "active",
    market: "PHYSICAL_GOLD",
    previousValueInWon: 390,
    providerResult: { kind: "success", valueInWon: 400 },
  },
];

describe("자산 평가 trigger별 대상 scope 계약", () => {
  it("[T-JOB-AST-001][JOB-AST-001] 개별 수동 갱신은 요청한 active 자산 하나만 평가하고 child receipt를 남긴다", async () => {
    const subject = createSubject({ households, targets });

    const result = await subject.refreshSingleAsset({
      actorHouseholdId: "house-a",
      assetId: "asset-a-stock",
      requestedAt: "2026-07-20T12:00:00+09:00",
      idempotencyKey: "manual:asset-a-stock:1",
    });

    expect(result).toMatchObject({
      kind: "complete",
      trigger: "manual-asset",
      householdIds: ["house-a"],
      processedTargetIds: ["target-a-stock"],
      snapshotRequestedForHouseholdIds: [],
    });
    expect(subject.currentAssetValues()).toEqual({ "asset-a-stock": 100 });
    expect(subject.childReceipts()).toEqual([
      expect.objectContaining({
        householdId: "house-a",
        assetId: "asset-a-stock",
        outcome: "succeeded",
        resultingValueInWon: 100,
      }),
    ]);
  });

  it("[T-JOB-AST-001][JOB-AST-001/AST-006] 자산 페이지 진입은 현재 가구 active 자산만 평가한다", async () => {
    const subject = createSubject({ households, targets });

    const result = await subject.refreshHouseholdOnPageEntry({
      actorHouseholdId: "house-a",
      requestedAt: "2026-07-20T12:00:00+09:00",
    });

    expect(result).toMatchObject({
      kind: "complete",
      trigger: "asset-page-entry",
      householdIds: ["house-a"],
      processedTargetIds: ["target-a-stock"],
    });
    expect(result.processedTargetIds).not.toContain("target-a-deleted");
    expect(result.processedTargetIds).not.toContain("target-b-fund");
    expect(subject.currentAssetValues()).toEqual({ "asset-a-stock": 100 });
  });

  it("[T-JOB-AST-001][JOB-AST-001/AST-006] 23:55 occurrence는 모든 active 가구의 active 자산만 평가하고 가구별 snapshot을 요청한다", async () => {
    const subject = createSubject({ households, targets, pageSize: 1 });

    const result = await subject.runDailyValuation({
      occurrenceId: "daily-assets:2026-07-20",
      scheduledFor: "2026-07-20T23:55:00+09:00",
      asOfDate: "2026-07-20",
    });

    expect(result).toMatchObject({
      kind: "complete",
      trigger: "daily-23:55",
      householdIds: ["house-a", "house-b"],
      processedTargetIds: ["target-a-stock", "target-b-fund"],
      pageReceipts: [
        expect.objectContaining({ targetIds: ["target-a-stock"], terminal: true }),
        expect.objectContaining({ targetIds: ["target-b-fund"], terminal: true }),
      ],
      snapshotRequestedForHouseholdIds: ["house-a", "house-b"],
    });
    expect(result.processedTargetIds).not.toContain("target-a-deleted");
    expect(result.processedTargetIds).not.toContain(
      "target-deleted-house-gold",
    );
    expect(subject.currentAssetValues()).toEqual({
      "asset-a-stock": 100,
      "asset-b-fund": 300,
    });
  });

  it("[T-JOB-AST-001][JOB-AST-001] 중간 page에서 중단되면 snapshot을 만들지 않고 checkpoint 뒤 재개 완료 후에만 요청한다", async () => {
    const subject = createSubject({
      households,
      targets,
      pageSize: 1,
      interruptAfterPage: 1,
    });

    const interrupted = await subject.runDailyValuation({
      occurrenceId: "daily-assets:2026-07-20",
      scheduledFor: "2026-07-20T23:55:00+09:00",
      asOfDate: "2026-07-20",
    });
    expect(interrupted).toMatchObject({
      kind: "interrupted",
      processedTargetIds: ["target-a-stock"],
      snapshotRequestedForHouseholdIds: [],
      checkpoint: expect.any(String),
    });

    const resumed = await subject.runDailyValuation({
      occurrenceId: "daily-assets:2026-07-20",
      scheduledFor: "2026-07-20T23:55:00+09:00",
      asOfDate: "2026-07-20",
      resumeFromCheckpoint: interrupted.checkpoint,
    });
    expect(resumed).toMatchObject({
      kind: "complete",
      processedTargetIds: ["target-a-stock", "target-b-fund"],
      snapshotRequestedForHouseholdIds: ["house-a", "house-b"],
    });
    expect(subject.childReceipts()).toHaveLength(2);
    expect(subject.listRuns()).toHaveLength(1);
  });
});
