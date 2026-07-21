import { describe, expect, it } from "vitest";
import {
  createAssetLifecycleWorkflowDriver,
  type Actor,
  type AssetLifecycle,
  type AssetLifecycleFixtureState,
  type AssetLifecycleWorkflowDriver,
  type AssetLifecycleWorkflowFixture,
} from "../../support/asset-lifecycle-workflow-driver";

/** 자산 논리 삭제·운영 복구·별도 영구 purge의 공개 Workflow 계약입니다. */
export interface AssetLifecycleWorkflowSubject
  extends AssetLifecycleWorkflowDriver {}

export function createSubject(
  fixture: AssetLifecycleWorkflowFixture,
): AssetLifecycleWorkflowSubject {
  return createAssetLifecycleWorkflowDriver(fixture);
}

const member: Actor = {
  actorId: "member-a",
  householdId: "house-1",
  capabilities: ["portfolio.asset.read", "portfolio.asset.write"],
};

const operator: Actor = {
  actorId: "operator-a",
  householdId: "house-1",
  capabilities: [
    "portfolio.asset.restore.read",
    "portfolio.asset.restore.deleted",
    "portfolio.asset.purge.permanent",
  ],
};

const purgeWorker: Actor = {
  actorId: "asset-purge-worker",
  householdId: "house-1",
  capabilities: ["portfolio.asset.purge.process"],
};

function state(
  lifecycle: AssetLifecycle = "active",
): AssetLifecycleFixtureState {
  return {
    asset: {
      assetId: "asset-1",
      householdId: "house-1",
      lifecycle,
      aggregateVersion: 4,
      ...(lifecycle === "deleted" || lifecycle === "purging"
        ? { deletedAt: "2026-03-20T09:00:00Z" }
        : {}),
    },
    dependents: {
      positions: [
        {
          positionId: "position-1",
          retained: true,
          eligibleForProcessing: lifecycle === "active",
        },
      ],
      automation: {
        retained: true,
        executionEnabled: lifecycle === "active",
        nextDueDate: "2026-03-18",
      },
      history: { retained: true, pointCount: 12 },
      paidDividendEvents: [
        { eventId: "dividend-paid-1", amountInWon: 5_000 },
      ],
      annualDividendTotalInWon: 5_000,
    },
  };
}

describe("Portfolio 자산 전체 lifecycle Workflow 계약", () => {
  it("[T-AST-002][T-AST-008][AST-006] 일반 삭제는 Asset만 논리 삭제하고 종속 데이터를 물리 삭제하지 않는다", async () => {
    const subject = createSubject({
      state: state(),
      now: "2026-03-20T09:00:00Z",
    });

    const result = await subject.deleteAsset({
      actor: member,
      commandId: "delete-1",
      idempotencyKey: "delete-1",
      assetId: "asset-1",
      expectedVersion: 4,
    });

    expect(result).toEqual({
      kind: "success",
      asset: expect.objectContaining({
        assetId: "asset-1",
        lifecycleState: "deleted",
        aggregateVersion: 5,
        deletedAt: "2026-03-20T09:00:00Z",
      }),
      receipt: {
        commandId: "delete-1",
        assetId: "asset-1",
        operation: "delete",
        resultingVersion: 5,
      },
    });
    expect(await subject.queryVisibleAsset(member, "asset-1")).toEqual({
      kind: "no-data",
    });
    expect(await subject.inspectOperationalState("asset-1")).toEqual(
      expect.objectContaining({
        asset: expect.objectContaining({ lifecycle: "deleted" }),
        dependents: expect.objectContaining({
          positions: [
            expect.objectContaining({
              retained: true,
              eligibleForProcessing: false,
            }),
          ],
          automation: expect.objectContaining({
            retained: true,
            executionEnabled: false,
          }),
          history: { retained: true, pointCount: 12 },
          paidDividendEvents: [
            { eventId: "dividend-paid-1", amountInWon: 5_000 },
          ],
          annualDividendTotalInWon: 5_000,
        }),
      }),
    );
    expect(subject.physicalDeleteAttemptsFromUserDelete()).toBe(0);
    expect(subject.receipts()).toEqual([
      expect.objectContaining({ commandId: "delete-1", operation: "delete" }),
    ]);
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "AssetLifecycleChanged.v1",
        assetId: "asset-1",
        before: "active",
        after: "deleted",
        aggregateVersion: 5,
      },
    ]);
    expect(subject.auditRecords()).toEqual([]);
  });

  it("[T-AST-002][AST-006/DEC-017] 일반 사용자는 삭제 목록과 복구를 이용할 수 없고 존재 여부도 노출받지 않는다", async () => {
    const initial = state("deleted");
    const subject = createSubject({ state: initial });

    expect(await subject.listDeletedAssetIds(member)).toEqual({
      kind: "forbidden",
      code: "DELETED_ASSET_LIST_FORBIDDEN",
    });
    expect(
      await subject.restoreAsset({
        actor: member,
        commandId: "restore-member",
        idempotencyKey: "restore-member",
        assetId: "asset-1",
        expectedVersion: 4,
        auditReason: "실수로 삭제",
      }),
    ).toEqual({ kind: "forbidden", code: "ASSET_RESTORE_FORBIDDEN" });
    expect(
      await subject.restoreAsset({
        actor: member,
        commandId: "restore-missing",
        idempotencyKey: "restore-missing",
        assetId: "missing-asset",
        expectedVersion: 1,
        auditReason: "복구 요청",
      }),
    ).toEqual({ kind: "forbidden", code: "ASSET_RESTORE_FORBIDDEN" });
    expect(await subject.inspectOperationalState("asset-1")).toEqual(initial);
    expect(subject.receipts()).toEqual([]);
    expect(subject.recordedEvents()).toEqual([]);
  });

  it("[T-AST-002][T-AUTO-003][AST-006/AUTO-003] 운영 복구는 보존된 종속 상태를 다시 사용하고 계산된 재개일을 Event에 기록한다", async () => {
    const subject = createSubject({
      state: state("deleted"),
      restoreResumeFromDate: "2026-05-18",
    });

    const result = await subject.restoreAsset({
      actor: operator,
      commandId: "restore-1",
      idempotencyKey: "restore-1",
      assetId: "asset-1",
      expectedVersion: 4,
      auditReason: "운영자 확인 후 복구",
    });

    expect(result).toEqual({
      kind: "success",
      asset: expect.objectContaining({
        lifecycleState: "active",
        aggregateVersion: 5,
      }),
      receipt: expect.objectContaining({
        commandId: "restore-1",
        operation: "restore",
        resultingVersion: 5,
      }),
    });
    expect(await subject.queryVisibleAsset(member, "asset-1")).toEqual({
      kind: "success",
      asset: expect.objectContaining({ lifecycleState: "active" }),
    });
    expect(await subject.inspectOperationalState("asset-1")).toEqual(
      expect.objectContaining({
        asset: expect.not.objectContaining({ deletedAt: expect.anything() }),
        dependents: expect.objectContaining({
          positions: [
            expect.objectContaining({
              retained: true,
              eligibleForProcessing: true,
            }),
          ],
          automation: expect.objectContaining({
            retained: true,
            executionEnabled: true,
          }),
          history: { retained: true, pointCount: 12 },
          annualDividendTotalInWon: 5_000,
        }),
      }),
    );
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "AssetLifecycleChanged.v1",
        assetId: "asset-1",
        before: "deleted",
        after: "active",
        aggregateVersion: 5,
        resumeFromDate: "2026-05-18",
      },
    ]);
    expect(subject.auditRecords()).toEqual([
      {
        commandId: "restore-1",
        actorId: "operator-a",
        assetId: "asset-1",
        operation: "restore",
        reason: "운영자 확인 후 복구",
      },
    ]);
  });

  it("[T-AST-002][AST-006] legacy isActive=false는 공개 Command 없이 deleted로 읽고 종속 이력을 그대로 둔다", async () => {
    const initial = state();
    const subject = createSubject({ state: initial, legacyIsActive: false });

    expect(await subject.queryVisibleAsset(member, "asset-1")).toEqual({
      kind: "no-data",
    });
    expect(await subject.inspectOperationalState("asset-1")).toEqual(
      expect.objectContaining({
        asset: expect.objectContaining({
          lifecycle: "deleted",
          aggregateVersion: 4,
        }),
        dependents: expect.objectContaining({
          history: initial.dependents.history,
          paidDividendEvents: initial.dependents.paidDividendEvents,
          annualDividendTotalInWon: 5_000,
        }),
      }),
    );
    expect(subject.receipts()).toEqual([]);
    expect(subject.recordedEvents()).toEqual([]);
  });

  it("[T-AST-002][AST-006/DEC-017] 영구 purge는 요청자와 worker를 분리하고 participant checkpoint부터 재개하며 배당 이력은 호출하지 않는다", async () => {
    const initial = state("deleted");
    const subject = createSubject({
      state: initial,
      now: "2026-06-01T00:00:00Z",
      purgePages: [
        {
          participant: "holdings",
          cursorAfter: "holdings:page-1",
          outcome: "retryable-failure",
        },
        {
          participant: "holdings",
          cursorBefore: "holdings:page-1",
          cursorAfter: "holdings:complete",
          outcome: "participant-completed",
        },
        {
          participant: "automation",
          cursorAfter: "automation:complete",
          outcome: "participant-completed",
        },
        {
          participant: "core",
          cursorAfter: "core:complete",
          outcome: "participant-completed",
        },
      ],
    });

    expect(await subject.listDeletedAssetIds(operator)).toEqual({
      kind: "success",
      assetIds: ["asset-1"],
    });
    const requested = await subject.requestPermanentPurge({
      actor: operator,
      commandId: "purge-request-1",
      idempotencyKey: "purge-request-1",
      assetId: "asset-1",
      expectedVersion: 4,
      confirmationRef: "confirmed-by-user-2026-06-01",
    });
    expect(requested).toEqual({
      kind: "purge-requested",
      asset: expect.objectContaining({
        lifecycleState: "purging",
        aggregateVersion: 5,
      }),
      process: expect.objectContaining({
        processId: "asset-purge:purge-request-1",
        confirmationRefHash: expect.stringMatching(/^sha256:/),
      }),
      receipt: expect.objectContaining({ operation: "purge-request" }),
    });
    expect(JSON.stringify(requested)).not.toContain(
      "confirmed-by-user-2026-06-01",
    );
    expect(subject.auditRecords()).toEqual([
      {
        commandId: "purge-request-1",
        actorId: "operator-a",
        assetId: "asset-1",
        operation: "purge-request",
        confirmationRefHash: expect.stringMatching(/^sha256:/),
      },
    ]);
    expect(JSON.stringify(subject.auditRecords())).not.toContain(
      "confirmed-by-user-2026-06-01",
    );
    expect(await subject.listDeletedAssetIds(operator)).toEqual({
      kind: "no-data",
    });

    expect(
      await subject.continuePermanentPurge({
        actor: operator,
        commandId: "purge-page-by-requester",
        idempotencyKey: "purge-page-by-requester",
        assetId: "asset-1",
        processId: "asset-purge:purge-request-1",
        participant: "holdings",
        limit: 50,
      }),
    ).toEqual({
      kind: "forbidden",
      code: "ASSET_PURGE_PROCESS_FORBIDDEN",
    });
    expect(subject.purgeParticipantCalls()).toEqual([]);

    const failedPage = await subject.continuePermanentPurge({
      actor: purgeWorker,
      commandId: "purge-holdings-1",
      idempotencyKey: "purge-holdings-1",
      assetId: "asset-1",
      processId: "asset-purge:purge-request-1",
      participant: "holdings",
      limit: 50,
    });
    expect(failedPage).toEqual({
      kind: "retryable-failure",
      code: "PURGE_PAGE_FAILED",
      checkpoint: "holdings:page-1",
    });
    expect(
      await subject.continuePermanentPurge({
        actor: purgeWorker,
        commandId: "purge-holdings-1-replay",
        idempotencyKey: "different-envelope-key",
        assetId: "asset-1",
        processId: "asset-purge:purge-request-1",
        participant: "holdings",
        limit: 50,
      }),
    ).toEqual(failedPage);
    expect(subject.purgeParticipantCalls()).toEqual(["holdings"]);
    expect(await subject.inspectOperationalState("asset-1")).toEqual(
      expect.objectContaining({
        asset: expect.objectContaining({ lifecycle: "purging" }),
        purgeProcess: expect.objectContaining({
          participants: expect.objectContaining({
            holdings: {
              status: "in-progress",
              checkpoint: "holdings:page-1",
            },
          }),
        }),
        dependents: expect.objectContaining({
          paidDividendEvents: initial.dependents.paidDividendEvents,
          annualDividendTotalInWon: 5_000,
        }),
      }),
    );
    expect(
      await subject.restoreAsset({
        actor: operator,
        commandId: "restore-during-purge",
        idempotencyKey: "restore-during-purge",
        assetId: "asset-1",
        expectedVersion: 5,
        auditReason: "복구 시도",
      }),
    ).toEqual({ kind: "conflict", code: "ASSET_PURGING_NOT_RESTORABLE" });

    expect(
      await subject.continuePermanentPurge({
        actor: purgeWorker,
        commandId: "purge-holdings-2",
        idempotencyKey: "purge-holdings-2",
        assetId: "asset-1",
        processId: "asset-purge:purge-request-1",
        participant: "holdings",
        cursor: "holdings:page-1",
        limit: 50,
      }),
    ).toMatchObject({ kind: "purge-page-processed" });
    expect(
      await subject.continuePermanentPurge({
        actor: purgeWorker,
        commandId: "purge-automation",
        idempotencyKey: "purge-automation",
        assetId: "asset-1",
        processId: "asset-purge:purge-request-1",
        participant: "automation",
        limit: 50,
      }),
    ).toMatchObject({ kind: "purge-page-processed" });
    const completed = await subject.continuePermanentPurge({
      actor: purgeWorker,
      commandId: "purge-core",
      idempotencyKey: "purge-core",
      assetId: "asset-1",
      processId: "asset-purge:purge-request-1",
      participant: "core",
      limit: 50,
    });
    expect(completed).toEqual({
      kind: "purge-completed",
      completion: {
        processId: "asset-purge:purge-request-1",
        completed: true,
        completedAt: "2026-06-01T00:00:00Z",
        resultHash: expect.stringMatching(/^sha256:/),
      },
      receipt: expect.objectContaining({ operation: "purge-page" }),
    });

    const finalState = await subject.inspectOperationalState("asset-1");
    expect(finalState).not.toHaveProperty("asset");
    expect(finalState).not.toHaveProperty("purgeProcess");
    expect(finalState).toEqual(
      expect.objectContaining({
        purgeCompletion: expect.objectContaining({ completed: true }),
        dependents: {
          positions: [],
          automation: expect.objectContaining({ retained: false }),
          history: { retained: false, pointCount: 0 },
          paidDividendEvents: initial.dependents.paidDividendEvents,
          annualDividendTotalInWon: 5_000,
        },
      }),
    );
    expect(JSON.stringify(finalState.purgeCompletion)).not.toContain("asset-1");
    expect(subject.receipts()).toEqual([]);
    expect(subject.auditRecords()).toEqual([]);
    expect(await subject.queryVisibleAsset(member, "asset-1")).toEqual({
      kind: "no-data",
    });
    expect(subject.purgeParticipantCalls()).toEqual([
      "holdings",
      "holdings",
      "automation",
      "core",
    ]);
    expect(subject.recordedEvents()).toEqual([]);
  });

  it("[T-AST-002][AST-006] 동일 멱등 키의 동일 삭제는 최초 결과를 재생하고 payload가 달라지면 충돌한다", async () => {
    const subject = createSubject({ state: state() });
    const command = {
      actor: member,
      commandId: "delete-idempotent",
      idempotencyKey: "delete-idempotent",
      assetId: "asset-1",
      expectedVersion: 4,
    } as const;

    const first = await subject.deleteAsset(command);
    const replay = await subject.deleteAsset(command);
    const mismatch = await subject.deleteAsset({
      ...command,
      commandId: "delete-idempotent-other-payload",
      expectedVersion: 5,
    });

    expect(replay).toEqual(first);
    expect(mismatch).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(subject.receipts()).toHaveLength(1);
    expect(subject.recordedEvents()).toHaveLength(1);
    expect(await subject.inspectOperationalState("asset-1")).toEqual(
      expect.objectContaining({
        asset: expect.objectContaining({ aggregateVersion: 5 }),
      }),
    );
  });

  it("[T-AST-002][AST-006] stale version과 허용되지 않은 source state는 receipt 없이 원자적으로 거부한다", async () => {
    const staleDelete = createSubject({ state: state() });
    expect(
      await staleDelete.deleteAsset({
        actor: member,
        commandId: "delete-stale",
        idempotencyKey: "delete-stale",
        assetId: "asset-1",
        expectedVersion: 3,
      }),
    ).toEqual({ kind: "conflict", code: "ASSET_VERSION_MISMATCH" });
    expect(await staleDelete.inspectOperationalState("asset-1")).toEqual(
      state(),
    );
    expect(staleDelete.receipts()).toEqual([]);

    const activePurge = createSubject({ state: state() });
    expect(
      await activePurge.requestPermanentPurge({
        actor: operator,
        commandId: "purge-active",
        idempotencyKey: "purge-active",
        assetId: "asset-1",
        expectedVersion: 4,
        confirmationRef: "confirmed",
      }),
    ).toEqual({ kind: "conflict", code: "ASSET_NOT_DELETED" });
    expect(await activePurge.inspectOperationalState("asset-1")).toEqual(
      state(),
    );
    expect(activePurge.receipts()).toEqual([]);
  });

  it("[T-AST-002][AST-006] 복구 감사 사유와 영구 purge 확인 근거는 필수이며 일반 사용자는 purge를 시작할 수 없다", async () => {
    const subject = createSubject({ state: state("deleted") });

    expect(
      await subject.restoreAsset({
        actor: operator,
        commandId: "restore-without-reason",
        idempotencyKey: "restore-without-reason",
        assetId: "asset-1",
        expectedVersion: 4,
        auditReason: "   ",
      }),
    ).toEqual({
      kind: "validation-error",
      code: "ASSET_RESTORE_AUDIT_REASON_REQUIRED",
    });
    expect(
      await subject.requestPermanentPurge({
        actor: operator,
        commandId: "purge-without-confirmation",
        idempotencyKey: "purge-without-confirmation",
        assetId: "asset-1",
        expectedVersion: 4,
        confirmationRef: "   ",
      }),
    ).toEqual({
      kind: "validation-error",
      code: "ASSET_PURGE_CONFIRMATION_REQUIRED",
    });
    expect(
      await subject.requestPermanentPurge({
        actor: member,
        commandId: "purge-by-member",
        idempotencyKey: "purge-by-member",
        assetId: "asset-1",
        expectedVersion: 4,
        confirmationRef: "confirmed",
      }),
    ).toEqual({ kind: "forbidden", code: "ASSET_PURGE_FORBIDDEN" });
    expect(await subject.inspectOperationalState("asset-1")).toEqual(
      state("deleted"),
    );
    expect(subject.receipts()).toEqual([]);
    expect(subject.purgeParticipantCalls()).toEqual([]);
    expect(subject.auditRecords()).toEqual([]);
  });

  it("[T-AST-002][AST-006] 타 가구 Actor의 삭제는 scope 오류로 끝나고 상태·Event를 변경하지 않는다", async () => {
    const subject = createSubject({ state: state() });

    expect(
      await subject.deleteAsset({
        actor: { ...member, householdId: "house-2" },
        commandId: "delete-cross-household",
        idempotencyKey: "delete-cross-household",
        assetId: "asset-1",
        expectedVersion: 4,
      }),
    ).toEqual({ kind: "forbidden", code: "HOUSEHOLD_SCOPE_MISMATCH" });
    expect(await subject.inspectOperationalState("asset-1")).toEqual(state());
    expect(subject.receipts()).toEqual([]);
    expect(subject.recordedEvents()).toEqual([]);
  });
});
