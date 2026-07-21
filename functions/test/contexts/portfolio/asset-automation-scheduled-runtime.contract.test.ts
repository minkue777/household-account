import { describe, expect, it } from "vitest";

import { createAssetAutomationScheduledRuntimeFixture } from "../../support/asset-automation-scheduled-runtime-fixture";

type TargetResult =
  | {
      readonly kind: "applied" | "already-processed";
      readonly executionKey: string;
      readonly nextDueDate: string;
    }
  | {
      readonly kind: "skipped" | "needs-attention" | "retryable-failure";
      readonly targetId: string;
      readonly code: string;
    };

interface PageResult {
  readonly completed: boolean;
  readonly nextCursor?: string;
  readonly results: readonly TargetResult[];
}

export interface AssetAutomationScheduledRuntimeSubject {
  processPage(input: {
    readonly occurrenceId: string;
    readonly asOfDate: string;
    readonly processedAt: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<PageResult>;
  appliedExecutionKeys(): readonly string[];
  applyCalls(): readonly string[];
}

export function createSubject(fixture: {
  readonly firstDueDate: string;
  readonly retryableFailureOn?: string;
}): AssetAutomationScheduledRuntimeSubject {
  return createAssetAutomationScheduledRuntimeFixture(fixture);
}

describe("ProcessDueAssetAutomation runtime 계약", () => {
  it("[T-AUTO-003][AUTO-003/DEC-052] page target 상한을 지키며 한 Plan의 오래된 누락 월부터 checkpoint 뒤에서 계속 처리한다", async () => {
    const subject = createSubject({ firstDueDate: "2026-01-18" });

    const first = await subject.processPage({
      occurrenceId: "asset-automation-daily:2026-03-20",
      asOfDate: "2026-03-20",
      processedAt: "2026-03-19T15:00:00.000Z",
      limit: 2,
    });
    expect(first).toMatchObject({
      completed: false,
      nextCursor: "after:2026-01-18",
    });
    expect(first.results.map((result) => result.kind)).toEqual([
      "applied",
      "applied",
    ]);

    const second = await subject.processPage({
      occurrenceId: "asset-automation-daily:2026-03-20",
      asOfDate: "2026-03-20",
      processedAt: "2026-03-19T15:00:00.000Z",
      cursor: first.nextCursor,
      limit: 2,
    });
    expect(second.results).toHaveLength(1);
    expect(subject.appliedExecutionKeys()).toEqual([
      "house-1:asset-1:savings-contribution:2026-01",
      "house-1:asset-1:savings-contribution:2026-02",
      "house-1:asset-1:savings-contribution:2026-03",
    ]);

    expect(
      await subject.processPage({
        occurrenceId: "asset-automation-daily:2026-03-20",
        asOfDate: "2026-03-20",
        processedAt: "2026-03-19T15:00:00.000Z",
        cursor: second.nextCursor,
        limit: 2,
      }),
    ).toEqual({ completed: true, results: [] });
  });

  it("[T-AUTO-003][AUTO-003] retryable 실패 뒤의 월을 건너뛰지 않고 해당 Plan 처리를 즉시 멈춘다", async () => {
    const subject = createSubject({
      firstDueDate: "2026-01-18",
      retryableFailureOn: "2026-01-18",
    });

    const result = await subject.processPage({
      occurrenceId: "asset-automation-daily:2026-03-20",
      asOfDate: "2026-03-20",
      processedAt: "2026-03-19T15:00:00.000Z",
      limit: 100,
    });

    expect(subject.applyCalls()).toEqual(["2026-01-18"]);
    expect(result).toEqual({
      completed: false,
      nextCursor: "after:2026-01-18",
      results: [
        {
          kind: "retryable-failure",
          targetId: "plan-1:2026-01",
          code: "AUTOMATION_UOW_COMMIT_FAILED",
        },
      ],
    });
  });

  it("page size가 유효하지 않으면 저장소를 호출하기 전에 거부한다", async () => {
    const subject = createSubject({ firstDueDate: "2026-01-18" });
    await expect(
      subject.processPage({
        occurrenceId: "run",
        asOfDate: "2026-03-20",
        processedAt: "2026-03-19T15:00:00.000Z",
        limit: 0,
      }),
    ).rejects.toThrow("INVALID_AUTOMATION_PAGE_SIZE");
    expect(subject.applyCalls()).toEqual([]);
  });
});
