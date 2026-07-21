import { describe, expect, it } from "vitest";
import { createAssetAutomationExecutionFixture } from "../../support/asset-automation-execution-fixture";

type AutomationKind = "savings-deposit" | "loan-repayment";

interface AutomationRevisionView {
  revision: number;
  effectiveFromMonth: string;
  amountInWon: number;
  configuredDay: number;
}

interface AutomationPlanView {
  planId: string;
  householdId: string;
  assetId: string;
  kind: AutomationKind;
  status: "active" | "needs-attention" | "suspended";
  nextDueDate: string;
  currentRevision: number;
  revisions: readonly AutomationRevisionView[];
  attentionCode?: string;
}

interface AutomatedAssetView {
  assetId: string;
  lifecycle: "active" | "deleted" | "purging";
  currentBalanceInWon: number;
  aggregateVersion: number;
}

interface AutomationExecutionView {
  executionId: string;
  executionKey: string;
  occurrenceId: string;
  planId: string;
  assetId: string;
  targetMonth: string;
  effectiveDate: string;
  appliedRevision: number;
  balanceDeltaInWon: number;
  resultingBalanceInWon: number;
  status: "applied";
}

interface AutomationReceipt {
  receiptId: string;
  occurrenceId: string;
  executionKey: string;
  resultingAssetVersion: number;
}

interface AutomationAppliedEvent {
  eventType: "AssetAutomationApplied.v1";
  executionId: string;
  executionKey: string;
  assetId: string;
  targetMonth: string;
  balanceDeltaInWon: number;
  aggregateVersion: number;
}

interface AutomationPageResult {
  pageNumber: number;
  planIds: readonly string[];
  checkpointAfter?: string;
  terminal: true;
}

interface AutomationRunResult {
  kind: "complete" | "partial-failure";
  occurrenceId: string;
  pageResults: readonly AutomationPageResult[];
  appliedExecutionKeys: readonly string[];
  retryableFailures: readonly {
    executionKey: string;
    code: string;
  }[];
  invalidPlanIds: readonly string[];
  checkpoint?: string;
}

interface AssetAutomationExecutionFixture {
  assets: readonly AutomatedAssetView[];
  plans: readonly AutomationPlanView[];
  outcomesByOccurrence?: Readonly<
    Record<
      string,
      Readonly<Record<string, "success" | "retryable-failure">>
    >
  >;
  pageSize?: number;
  transactionMayRetryCallback?: boolean;
}

/** 매일 00:00 due-plan 처리와 Portfolio UoW 반영의 공개 계약입니다. */
export interface AssetAutomationExecutionSubject {
  runOccurrence(input: {
    occurrenceId: string;
    scheduledFor: string;
    asOfDate: string;
    resumeFromCheckpoint?: string;
  }): Promise<AutomationRunResult>;
  inspectAsset(assetId: string): Promise<AutomatedAssetView>;
  inspectPlan(planId: string): Promise<AutomationPlanView>;
  listExecutions(planId: string): Promise<readonly AutomationExecutionView[]>;
  receipts(): readonly AutomationReceipt[];
  recordedEvents(): readonly AutomationAppliedEvent[];
}

export function createSubject(
  fixture: AssetAutomationExecutionFixture,
): AssetAutomationExecutionSubject {
  return createAssetAutomationExecutionFixture(fixture);
}

function asset(
  overrides: Partial<AutomatedAssetView> = {},
): AutomatedAssetView {
  return {
    assetId: "asset-savings",
    lifecycle: "active",
    currentBalanceInWon: 1_000_000,
    aggregateVersion: 3,
    ...overrides,
  };
}

function plan(
  overrides: Partial<AutomationPlanView> = {},
): AutomationPlanView {
  return {
    planId: "plan-savings",
    householdId: "house-1",
    assetId: "asset-savings",
    kind: "savings-deposit",
    status: "active",
    nextDueDate: "2026-03-18",
    currentRevision: 1,
    revisions: [
      {
        revision: 1,
        effectiveFromMonth: "2026-03",
        amountInWon: 100_000,
        configuredDay: 18,
      },
    ],
    ...overrides,
  };
}

describe("Asset Automation 매일 due 처리·UoW 계약", () => {
  it("[T-AUTO-001][T-AUTO-003][AUTO-001/AUTO-003/DEC-052] 실패한 due는 nextDueDate를 전진시키지 않고 다음 00:00 성공에서 한 번만 반영한다", async () => {
    const subject = createSubject({
      assets: [asset()],
      plans: [plan()],
      outcomesByOccurrence: {
        "automation:2026-03-18": {
          "plan-savings:2026-03": "retryable-failure",
        },
        "automation:2026-03-19": {
          "plan-savings:2026-03": "retryable-failure",
        },
        "automation:2026-03-20": {
          "plan-savings:2026-03": "success",
        },
      },
    });

    for (const date of ["2026-03-18", "2026-03-19"] as const) {
      const failed = await subject.runOccurrence({
        occurrenceId: `automation:${date}`,
        scheduledFor: `${date}T00:00:00+09:00`,
        asOfDate: date,
      });
      expect(failed).toMatchObject({
        kind: "partial-failure",
        appliedExecutionKeys: [],
        retryableFailures: [
          {
            executionKey: "plan-savings:2026-03",
            code: "AUTOMATION_APPLY_RETRYABLE",
          },
        ],
      });
      expect(await subject.inspectAsset("asset-savings")).toEqual(asset());
      expect(await subject.inspectPlan("plan-savings")).toEqual(
        expect.objectContaining({ nextDueDate: "2026-03-18" }),
      );
      expect(await subject.listExecutions("plan-savings")).toEqual([]);
    }

    const success = await subject.runOccurrence({
      occurrenceId: "automation:2026-03-20",
      scheduledFor: "2026-03-20T00:00:00+09:00",
      asOfDate: "2026-03-20",
    });

    expect(success).toMatchObject({
      kind: "complete",
      appliedExecutionKeys: ["plan-savings:2026-03"],
      retryableFailures: [],
    });
    expect(await subject.inspectAsset("asset-savings")).toEqual({
      ...asset(),
      currentBalanceInWon: 1_100_000,
      aggregateVersion: 4,
    });
    expect(await subject.inspectPlan("plan-savings")).toEqual(
      expect.objectContaining({ nextDueDate: "2026-04-18" }),
    );
    expect(await subject.listExecutions("plan-savings")).toEqual([
      expect.objectContaining({
        executionKey: "plan-savings:2026-03",
        occurrenceId: "automation:2026-03-20",
        targetMonth: "2026-03",
        appliedRevision: 1,
        balanceDeltaInWon: 100_000,
        resultingBalanceInWon: 1_100_000,
        status: "applied",
      }),
    ]);
    expect(subject.receipts()).toEqual([
      expect.objectContaining({
        executionKey: "plan-savings:2026-03",
        resultingAssetVersion: 4,
      }),
    ]);
    expect(subject.recordedEvents()).toEqual([
      expect.objectContaining({
        eventType: "AssetAutomationApplied.v1",
        executionKey: "plan-savings:2026-03",
        balanceDeltaInWon: 100_000,
        aggregateVersion: 4,
      }),
    ]);
  });

  it("[T-AUTO-003][AUTO-003/DEC-052] 여러 누락 월은 오래된 월부터 모두 처리하고 각 월마다 독립 execution을 남긴다", async () => {
    const subject = createSubject({
      assets: [asset()],
      plans: [
        plan({
          nextDueDate: "2026-01-18",
          revisions: [
            {
              revision: 1,
              effectiveFromMonth: "2026-01",
              amountInWon: 100_000,
              configuredDay: 18,
            },
          ],
        }),
      ],
      pageSize: 2,
    });

    const result = await subject.runOccurrence({
      occurrenceId: "automation:2026-03-20",
      scheduledFor: "2026-03-20T00:00:00+09:00",
      asOfDate: "2026-03-20",
    });

    expect(result).toMatchObject({
      kind: "complete",
      appliedExecutionKeys: [
        "plan-savings:2026-01",
        "plan-savings:2026-02",
        "plan-savings:2026-03",
      ],
      pageResults: [
        expect.objectContaining({ terminal: true }),
        expect.objectContaining({ terminal: true }),
      ],
    });
    expect(
      (await subject.listExecutions("plan-savings")).map(
        ({ targetMonth }) => targetMonth,
      ),
    ).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(await subject.inspectAsset("asset-savings")).toEqual(
      expect.objectContaining({ currentBalanceInWon: 1_300_000 }),
    );
    expect(await subject.inspectPlan("plan-savings")).toEqual(
      expect.objectContaining({ nextDueDate: "2026-04-18" }),
    );
    expect(subject.receipts()).toHaveLength(3);
    expect(subject.recordedEvents()).toHaveLength(3);
  });

  it("[T-AUTO-003][AUTO-003] 잘못된 Plan은 needs-attention으로 격리하고 같은 page의 정상 Plan은 완료한다", async () => {
    const validAsset = asset();
    const invalidAsset = asset({
      assetId: "asset-invalid",
      currentBalanceInWon: 500_000,
    });
    const subject = createSubject({
      assets: [validAsset, invalidAsset],
      plans: [
        plan(),
        plan({
          planId: "plan-invalid",
          assetId: "asset-invalid",
          revisions: [
            {
              revision: 1,
              effectiveFromMonth: "2026-03",
              amountInWon: Number.NaN,
              configuredDay: 18,
            },
          ],
        }),
      ],
    });

    const result = await subject.runOccurrence({
      occurrenceId: "automation:2026-03-18",
      scheduledFor: "2026-03-18T00:00:00+09:00",
      asOfDate: "2026-03-18",
    });

    expect(result).toMatchObject({
      kind: "partial-failure",
      appliedExecutionKeys: ["plan-savings:2026-03"],
      invalidPlanIds: ["plan-invalid"],
    });
    expect(await subject.inspectPlan("plan-invalid")).toEqual(
      expect.objectContaining({
        status: "needs-attention",
        nextDueDate: "2026-03-18",
        attentionCode: "INVALID_AUTOMATION_AMOUNT",
      }),
    );
    expect(await subject.inspectAsset("asset-invalid")).toEqual(invalidAsset);
    expect(await subject.inspectAsset("asset-savings")).toEqual(
      expect.objectContaining({ currentBalanceInWon: 1_100_000 }),
    );
  });

  it("[T-AUTO-001][T-AUTO-003][AUTO-001/AUTO-003] transaction callback 재실행과 occurrence replay에도 delta·receipt·Event는 한 번뿐이다", async () => {
    const subject = createSubject({
      assets: [asset()],
      plans: [plan()],
      transactionMayRetryCallback: true,
    });
    const input = {
      occurrenceId: "automation:2026-03-18",
      scheduledFor: "2026-03-18T00:00:00+09:00",
      asOfDate: "2026-03-18",
    };

    const first = await subject.runOccurrence(input);
    const replay = await subject.runOccurrence(input);

    expect(replay).toEqual(first);
    expect(await subject.inspectAsset("asset-savings")).toEqual(
      expect.objectContaining({
        currentBalanceInWon: 1_100_000,
        aggregateVersion: 4,
      }),
    );
    expect(await subject.listExecutions("plan-savings")).toHaveLength(1);
    expect(subject.receipts()).toHaveLength(1);
    expect(subject.recordedEvents()).toHaveLength(1);
  });

  it("[T-AUTO-002][T-AUTO-003][AUTO-002/AUTO-003] 실행 월의 effective revision을 고정하고 이후 Plan 변경이 과거 execution을 다시 쓰지 않는다", async () => {
    const subject = createSubject({
      assets: [asset()],
      plans: [
        plan({
          nextDueDate: "2026-03-18",
          currentRevision: 2,
          revisions: [
            {
              revision: 1,
              effectiveFromMonth: "2026-03",
              amountInWon: 100_000,
              configuredDay: 18,
            },
            {
              revision: 2,
              effectiveFromMonth: "2026-04",
              amountInWon: 200_000,
              configuredDay: 18,
            },
          ],
        }),
      ],
    });

    await subject.runOccurrence({
      occurrenceId: "automation:2026-03-18",
      scheduledFor: "2026-03-18T00:00:00+09:00",
      asOfDate: "2026-03-18",
    });
    const marchExecution = (await subject.listExecutions("plan-savings"))[0];
    await subject.runOccurrence({
      occurrenceId: "automation:2026-04-18",
      scheduledFor: "2026-04-18T00:00:00+09:00",
      asOfDate: "2026-04-18",
    });

    expect(await subject.listExecutions("plan-savings")).toEqual([
      expect.objectContaining({
        targetMonth: "2026-03",
        appliedRevision: 1,
        balanceDeltaInWon: 100_000,
      }),
      expect.objectContaining({
        targetMonth: "2026-04",
        appliedRevision: 2,
        balanceDeltaInWon: 200_000,
      }),
    ]);
    expect((await subject.listExecutions("plan-savings"))[0]).toEqual(
      marchExecution,
    );
  });

  it("[T-AUTO-003][AUTO-003/AST-006] deleted·purging 자산 Plan은 due 조회와 실행에서 제외한다", async () => {
    const subject = createSubject({
      assets: [asset({ lifecycle: "deleted" })],
      plans: [plan({ status: "suspended" })],
    });

    expect(
      await subject.runOccurrence({
        occurrenceId: "automation:2026-03-20",
        scheduledFor: "2026-03-20T00:00:00+09:00",
        asOfDate: "2026-03-20",
      }),
    ).toMatchObject({
      kind: "complete",
      pageResults: [],
      appliedExecutionKeys: [],
      retryableFailures: [],
    });
    expect(await subject.inspectAsset("asset-savings")).toEqual(
      asset({ lifecycle: "deleted" }),
    );
    expect(await subject.listExecutions("plan-savings")).toEqual([]);
    expect(subject.receipts()).toEqual([]);
    expect(subject.recordedEvents()).toEqual([]);
  });
});
