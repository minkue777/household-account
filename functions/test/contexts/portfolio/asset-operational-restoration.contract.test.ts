import { describe, expect, it } from "vitest";
import {
  createAssetOperationalRestorationDriver,
  type AssetOperationalRestorationDriver,
  type AssetOperationalRestorationSeed,
  type OperationalRestorationActor,
} from "../../support/asset-operational-restoration-driver";

/** 삭제 자산의 운영 복구 권한과 자동화 재개 경계를 검증하는 공개 계약입니다. */
export interface AssetOperationalRestorationSubject
  extends AssetOperationalRestorationDriver {}

export function createSubject(
  seed: AssetOperationalRestorationSeed,
): AssetOperationalRestorationSubject {
  return createAssetOperationalRestorationDriver(seed);
}

const householdId = "household-a";
const assetId = "asset-savings";
const member: OperationalRestorationActor = {
  kind: "member",
  householdId,
  capabilities: ["portfolio.asset.read", "portfolio.asset.write"],
};
const administrator: OperationalRestorationActor = {
  kind: "administrator",
  householdId,
  capabilities: [
    "portfolio.asset.restore.deleted",
    "portfolio.asset.restore.read",
  ],
};
const operationsAgent: OperationalRestorationActor = {
  kind: "operations-agent",
  householdId,
  capabilities: [
    "portfolio.asset.restore.deleted",
    "portfolio.asset.restore.read",
  ],
};

function deletedSeed(
  overrides?: Partial<AssetOperationalRestorationSeed["asset"]>,
): AssetOperationalRestorationSeed {
  return {
    asset: {
      householdId,
      assetId,
      lifecycle: "deleted",
      version: 4,
      deletedOn: "2026-03-20",
      ...overrides,
    },
    automation: {
      configuredDay: 18,
      pendingMonths: [],
    },
  };
}

function restoreCommand(
  actor: OperationalRestorationActor,
  restoredOn = "2026-05-17",
) {
  return {
    actor,
    commandId: `restore:${actor.kind}:${restoredOn}`,
    idempotencyKey: `restore:${actor.kind}:${restoredOn}`,
    assetId,
    restoredOn,
    expectedVersion: 4,
    auditReason: "실수로 삭제한 자산 복구",
  } as const;
}

describe("자산 운영 복구 공개 계약", () => {
  it("[T-AST-002][AST-006][DEC-017] 일반 사용자는 자산 write 권한이 있어도 삭제 자산을 복구할 수 없다", async () => {
    const subject = createSubject(deletedSeed());

    await expect(
      subject.restoreDeletedAsset(restoreCommand(member)),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "ASSET_RESTORE_FORBIDDEN",
    });
  });

  it("[T-AST-002][AST-006][DEC-017] 일반 사용자는 삭제 자산 목록을 조회할 수 없다", async () => {
    const subject = createSubject(deletedSeed());

    await expect(subject.listDeletedAssets({ actor: member })).resolves.toEqual({
      kind: "forbidden",
      code: "DELETED_ASSET_LIST_FORBIDDEN",
    });
  });

  it.each([
    ["관리자", administrator],
    ["승인된 운영 에이전트", operationsAgent],
  ])(
    "[T-AST-002][AST-006][DEC-017] %s만 감사 사유가 있는 삭제 자산을 복구한다",
    async (_label, actor) => {
      const subject = createSubject(deletedSeed());

      await expect(
        subject.restoreDeletedAsset(restoreCommand(actor)),
      ).resolves.toEqual({
        kind: "success",
        assetId,
        lifecycle: "active",
        version: 5,
        resumeFromDate: "2026-05-18",
      });
    },
  );

  it("[T-AST-002][AST-006][DEC-017] 운영 복구도 감사 사유가 없으면 변경하지 않는다", async () => {
    const subject = createSubject(deletedSeed());

    await expect(
      subject.restoreDeletedAsset({
        ...restoreCommand(administrator),
        auditReason: "   ",
      }),
    ).resolves.toEqual({
      kind: "validation-error",
      code: "ASSET_RESTORE_AUDIT_REASON_REQUIRED",
    });
  });

  it("[T-AST-002][AST-006][DEC-017] purging이 시작된 자산은 관리자도 복구할 수 없다", async () => {
    const subject = createSubject(deletedSeed({ lifecycle: "purging" }));

    await expect(
      subject.restoreDeletedAsset(restoreCommand(administrator)),
    ).resolves.toEqual({
      kind: "conflict",
      code: "ASSET_PURGING_NOT_RESTORABLE",
    });
  });

  it.each([
    ["2026-05-17", "2026-05-18"],
    ["2026-05-18", "2026-05-18"],
    ["2026-05-19", "2026-06-18"],
  ])(
    "[T-AUTO-003][AUTO-003][DEC-052] %s 운영 복구는 최초 재개 실행일을 %s로 정한다",
    async (restoredOn, resumeFromDate) => {
      const subject = createSubject(deletedSeed());

      const result = await subject.restoreDeletedAsset(
        restoreCommand(administrator, restoredOn),
      );

      expect(result).toMatchObject({ kind: "success", resumeFromDate });
    },
  );

  it("[T-AUTO-003][AUTO-003][DEC-052] 삭제 전 overdue는 보존하고 삭제 기간은 소급하지 않는다", async () => {
    const subject = createSubject({
      ...deletedSeed(),
      automation: {
        configuredDay: 18,
        pendingMonths: ["2026-03"],
      },
    });

    await subject.restoreDeletedAsset(restoreCommand(administrator));

    await expect(
      subject.listDueMonths({
        actor: operationsAgent,
        assetId,
        asOfDate: "2026-06-20",
      }),
    ).resolves.toEqual(["2026-03", "2026-05", "2026-06"]);
  });

  it("[T-AUTO-003][AUTO-003][DEC-052] 자동화 Plan이 없으면 변경 의도 없이 자산 복구만 같은 UoW에서 성공한다", async () => {
    const seed = deletedSeed();
    const subject = createSubject({ asset: seed.asset });

    await expect(
      subject.restoreDeletedAsset(restoreCommand(administrator)),
    ).resolves.toEqual({
      kind: "success",
      assetId,
      lifecycle: "active",
      version: 5,
    });
    await expect(subject.inspectState()).resolves.toEqual({
      asset: {
        householdId,
        assetId,
        lifecycle: "active",
        version: 5,
      },
    });
    expect(subject.receipts()).toHaveLength(1);
    expect(subject.recordedEvents()).toEqual([
      expect.not.objectContaining({ resumeFromDate: expect.anything() }),
    ]);
  });

  it("[T-AUTO-003][AUTO-003][DEC-052] Automation participant 준비 실패는 자산·Plan·receipt를 모두 그대로 두며 재시도할 수 있다", async () => {
    const subject = createSubject({
      ...deletedSeed(),
      automation: { configuredDay: 18, pendingMonths: ["2026-03"] },
      failNextParticipantPreparation: true,
    });
    const command = restoreCommand(administrator);

    await expect(subject.restoreDeletedAsset(command)).resolves.toEqual({
      kind: "retryable-failure",
      code: "AUTOMATION_RESTORE_PREPARE_RETRYABLE",
    });
    await expect(subject.inspectState()).resolves.toMatchObject({
      asset: { lifecycle: "deleted", version: 4 },
      automation: { resumeRevisions: [], suspensionIntervals: [] },
    });
    expect(subject.receipts()).toEqual([]);
    expect(subject.recordedEvents()).toEqual([]);
    expect(subject.auditRecords()).toEqual([]);

    await expect(subject.restoreDeletedAsset(command)).resolves.toMatchObject({
      kind: "success",
      resumeFromDate: "2026-05-18",
    });
    expect(subject.receipts()).toHaveLength(1);
  });

  it("[T-AUTO-003][AUTO-003][DEC-052] 결합 UoW commit 실패는 부분 활성화를 남기지 않고 동일 요청 재시도에서 한 번만 확정한다", async () => {
    const subject = createSubject({
      ...deletedSeed(),
      automation: { configuredDay: 18, pendingMonths: ["2026-03"] },
      failNextRestorationCommit: true,
    });
    const command = restoreCommand(operationsAgent);

    await expect(subject.restoreDeletedAsset(command)).resolves.toEqual({
      kind: "retryable-failure",
      code: "ASSET_RESTORE_COMMIT_RETRYABLE",
    });
    await expect(subject.inspectState()).resolves.toMatchObject({
      asset: { lifecycle: "deleted", version: 4 },
      automation: { resumeRevisions: [], suspensionIntervals: [] },
    });
    expect(subject.receipts()).toEqual([]);
    expect(subject.recordedEvents()).toEqual([]);
    expect(subject.auditRecords()).toEqual([]);

    await expect(subject.restoreDeletedAsset(command)).resolves.toMatchObject({
      kind: "success",
      version: 5,
      resumeFromDate: "2026-05-18",
    });
    expect(subject.receipts()).toHaveLength(1);
    expect(subject.recordedEvents()).toHaveLength(1);
    expect(subject.auditRecords()).toHaveLength(1);
  });

  it("[T-AST-002][T-AUTO-003][AST-006][DEC-052] 같은 멱등 요청은 계산된 재개일을 포함한 최초 결과만 재생한다", async () => {
    const subject = createSubject(deletedSeed());
    const command = restoreCommand(administrator);

    const first = await subject.restoreDeletedAsset(command);
    const replay = await subject.restoreDeletedAsset(command);
    const mismatch = await subject.restoreDeletedAsset({
      ...command,
      commandId: "restore:mismatched-payload",
      restoredOn: "2026-05-19",
    });

    expect(replay).toEqual(first);
    expect(replay).toMatchObject({
      kind: "success",
      resumeFromDate: "2026-05-18",
    });
    expect(mismatch).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(subject.receipts()).toHaveLength(1);
    expect(subject.recordedEvents()).toHaveLength(1);
    expect(subject.auditRecords()).toHaveLength(1);
  });
});
