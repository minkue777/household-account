import { describe, expect, it } from "vitest";
import { createDailyValuationRecoveryFixture } from "../../support/daily-valuation-recovery-fixture";

interface LegacyValuationAsset {
  assetId: string;
  legacyIsActive?: boolean;
  lifecycleState?: "active" | "deleted";
  currentBalance: number;
  aggregateVersion: number;
}

type ProviderOutcome =
  | { kind: "success"; valueInWon: number }
  | { kind: "retryable-failure"; code: string };

interface ValuationRunView {
  kind: "complete" | "partial-failure";
  succeeded: readonly string[];
  retryableFailed: readonly { assetId: string; code: string }[];
  excludedDeleted: readonly string[];
}

interface DailyValuationRecoveryEvent {
  eventType: "AssetValuationChanged.v1";
  assetId: string;
  currentSignedBalance: number;
}

export interface DailyValuationRecoverySubject {
  run(input: {
    runId: string;
    outcomes: Readonly<Record<string, ProviderOutcome>>;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<ValuationRunView>;
  currentAssets(): readonly (LegacyValuationAsset & {
    normalizedLifecycle: "active" | "deleted";
  })[];
  recordedEvents(): readonly DailyValuationRecoveryEvent[];
}

export function createSubject(seed: {
  assets: readonly LegacyValuationAsset[];
}): DailyValuationRecoverySubject {
  return createDailyValuationRecoveryFixture(seed);
}

const assets: readonly LegacyValuationAsset[] = [
  {
    assetId: "missing-is-active",
    currentBalance: 100,
    aggregateVersion: 1,
  },
  {
    assetId: "legacy-true",
    legacyIsActive: true,
    currentBalance: 200,
    aggregateVersion: 1,
  },
  {
    assetId: "legacy-false",
    legacyIsActive: false,
    currentBalance: 300,
    aggregateVersion: 1,
  },
];

describe("일일 자산 평가 lifecycle 정규화와 부분 실패 수렴 계약", () => {
  it("[T-JOB-AST-002][JOB-AST-003] isActive 누락·true는 active, false는 deleted로 동일 정규화하고 실패 범위를 보존한다", async () => {
    const subject = createSubject({ assets });

    const result = await subject.run({
      runId: "run-1",
      outcomes: {
        "missing-is-active": { kind: "success", valueInWon: 1_000 },
        "legacy-true": { kind: "retryable-failure", code: "MARKET_TIMEOUT" },
      },
      expectedVersions: {
        "missing-is-active": 1,
        "legacy-true": 1,
      },
    });

    expect(result).toEqual({
      kind: "partial-failure",
      succeeded: ["missing-is-active"],
      retryableFailed: [
        { assetId: "legacy-true", code: "MARKET_TIMEOUT" },
      ],
      excludedDeleted: ["legacy-false"],
    });
    expect(subject.currentAssets()).toEqual([
      expect.objectContaining({
        assetId: "missing-is-active",
        normalizedLifecycle: "active",
        currentBalance: 1_000,
        aggregateVersion: 2,
      }),
      expect.objectContaining({
        assetId: "legacy-true",
        normalizedLifecycle: "active",
        currentBalance: 200,
        aggregateVersion: 1,
      }),
      expect.objectContaining({
        assetId: "legacy-false",
        normalizedLifecycle: "deleted",
        currentBalance: 300,
        aggregateVersion: 1,
      }),
    ]);
  });

  it("[T-JOB-AST-002][JOB-AST-003] 재실행은 실패 자산만 성공으로 수렴시키고 완료 자산을 중복 변경하지 않는다", async () => {
    const subject = createSubject({ assets });
    await subject.run({
      runId: "run-1",
      outcomes: {
        "missing-is-active": { kind: "success", valueInWon: 1_000 },
        "legacy-true": { kind: "retryable-failure", code: "MARKET_TIMEOUT" },
      },
      expectedVersions: {
        "missing-is-active": 1,
        "legacy-true": 1,
      },
    });

    const resumed = await subject.run({
      runId: "run-1:resume",
      outcomes: {
        "legacy-true": { kind: "success", valueInWon: 2_000 },
      },
      expectedVersions: { "legacy-true": 1 },
    });

    expect(resumed).toEqual({
      kind: "complete",
      succeeded: ["legacy-true"],
      retryableFailed: [],
      excludedDeleted: ["legacy-false"],
    });
    expect(subject.currentAssets()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: "missing-is-active",
          currentBalance: 1_000,
          aggregateVersion: 2,
        }),
        expect.objectContaining({
          assetId: "legacy-true",
          currentBalance: 2_000,
          aggregateVersion: 2,
        }),
      ]),
    );
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "AssetValuationChanged.v1",
        assetId: "missing-is-active",
        currentSignedBalance: 1_000,
      },
      {
        eventType: "AssetValuationChanged.v1",
        assetId: "legacy-true",
        currentSignedBalance: 2_000,
      },
    ]);
  });

  it("[T-JOB-AST-002][JOB-AST-003] version 경합은 해당 Asset을 변경하지 않고 재시도 범위로 반환한다", async () => {
    const subject = createSubject({ assets });

    const result = await subject.run({
      runId: "version-conflict",
      outcomes: {
        "legacy-true": { kind: "success", valueInWon: 2_000 },
      },
      expectedVersions: { "legacy-true": 99 },
    });

    expect(result).toEqual({
      kind: "partial-failure",
      succeeded: [],
      retryableFailed: [
        { assetId: "legacy-true", code: "ASSET_VERSION_MISMATCH" },
      ],
      excludedDeleted: ["legacy-false"],
    });
    expect(subject.currentAssets()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: "legacy-true",
          currentBalance: 200,
          aggregateVersion: 1,
        }),
      ]),
    );
    expect(subject.recordedEvents()).toEqual([]);
  });
});
