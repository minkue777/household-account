import { describe, expect, it } from "vitest";
import {
  createMigrationRunnerFixture,
  type MigrationDocument,
  type MigrationRunnerFixtureSubject,
} from "../../support/migration-runner-fixture";

export interface MigrationRunnerContractSubject
  extends MigrationRunnerFixtureSubject {}

export function createSubject(fixture: {
  documents: readonly MigrationDocument[];
  pageSize?: number;
  failAfterPages?: number;
}): MigrationRunnerContractSubject {
  return createMigrationRunnerFixture(fixture);
}

const documents: MigrationDocument[] = [
  { documentId: "a-1", householdId: "house-a", schemaVersion: 1 },
  { documentId: "a-2", householdId: "house-a", schemaVersion: 1 },
  { documentId: "a-current", householdId: "house-a", schemaVersion: 2 },
  { documentId: "b-1", householdId: "house-b", schemaVersion: 1 },
  { documentId: "unscoped", schemaVersion: 1 },
];

describe("운영 Migration Runner 계약", () => {
  it("[T-SYS-009][SYS-009] 일반 client composition에는 migration·backfill·repair Input Port가 export되지 않는다", () => {
    expect(createSubject({ documents }).clientCompositionExports()).not.toEqual(
      expect.arrayContaining([
        "RunMigration",
        "RunBackfill",
        "RunRepair",
        "MigrationRunnerContractSubject",
      ]),
    );
  });

  it("[T-SYS-009][SYS-009] 일반 client 호출은 전역 조회·보정 전에 거부한다", async () => {
    const subject = createSubject({ documents });
    expect(
      await subject.run({
        actor: "client",
        migrationId: "schema-v2",
        householdId: "house-a",
        fromSchemaVersion: 1,
        mode: "apply",
      }),
    ).toEqual({ kind: "forbidden", code: "OPERATIONS_ACTOR_REQUIRED" });
    expect(subject.documents()).toEqual(documents);
  });

  it("[T-SYS-009][SYS-009] dry-run은 명시 scope의 대상만 계획하고 업무 문서를 변경하지 않는다", async () => {
    const subject = createSubject({ documents });
    const result = await subject.run({
      actor: "operations",
      migrationId: "schema-v2",
      householdId: "house-a",
      fromSchemaVersion: 1,
      mode: "dry-run",
    });

    expect(result).toEqual({
      kind: "dry-run",
      plan: {
        migrationId: "schema-v2",
        scope: { householdId: "house-a", fromSchemaVersion: 1 },
        plannedDocumentIds: ["a-1", "a-2"],
        planHash: expect.any(String),
      },
    });
    expect(subject.documents()).toEqual(documents);
  });

  it("[T-SYS-009][SYS-009] apply의 계획 hash가 dry-run과 다르면 변경 없이 중단한다", async () => {
    const subject = createSubject({ documents });
    expect(
      await subject.run({
        actor: "operations",
        migrationId: "schema-v2",
        householdId: "house-a",
        fromSchemaVersion: 1,
        mode: "apply",
        expectedPlanHash: "stale-plan-hash",
      }),
    ).toEqual({
      kind: "conflict",
      code: "MIGRATION_PLAN_RECONCILIATION_MISMATCH",
    });
    expect(subject.documents()).toEqual(documents);
  });

  it("[T-SYS-009][SYS-009] page 실패 checkpoint 재시도는 이미 처리한 문서를 중복 변경하지 않고 수렴한다", async () => {
    const subject = createSubject({ documents, pageSize: 1, failAfterPages: 1 });
    const dryRun = await subject.run({
      actor: "operations",
      migrationId: "schema-v2",
      householdId: "house-a",
      fromSchemaVersion: 1,
      mode: "dry-run",
    });
    if (dryRun.kind !== "dry-run") throw new Error("dry-run fixture가 필요합니다.");

    const first = await subject.run({
      actor: "operations",
      migrationId: "schema-v2",
      householdId: "house-a",
      fromSchemaVersion: 1,
      mode: "apply",
      expectedPlanHash: dryRun.plan.planHash,
    });
    expect(first).toMatchObject({
      kind: "retryable-failure",
      code: "MIGRATION_PAGE_FAILED",
      checkpoint: expect.any(String),
    });
    if (first.kind !== "retryable-failure" || !first.checkpoint) return;

    const replay = await subject.run({
      actor: "operations",
      migrationId: "schema-v2",
      householdId: "house-a",
      fromSchemaVersion: 1,
      mode: "apply",
      expectedPlanHash: dryRun.plan.planHash,
      checkpoint: first.checkpoint,
    });

    expect(replay).toEqual({
      kind: "applied",
      planHash: dryRun.plan.planHash,
      migratedDocumentIds: ["a-1", "a-2"],
      reconciliation: {
        plannedCount: 2,
        migratedCount: 2,
        remainingCount: 0,
        beforeHash: expect.any(String),
        afterHash: expect.any(String),
      },
    });
    if (replay.kind === "applied") {
      expect(replay.reconciliation.beforeHash).not.toBe(
        replay.reconciliation.afterHash,
      );
    }
    expect(
      subject
        .documents()
        .filter(({ documentId }) => ["a-1", "a-2"].includes(documentId))
        .map(({ schemaVersion }) => schemaVersion),
    ).toEqual([2, 2]);
    expect(subject.documents().find(({ documentId }) => documentId === "b-1"))
      .toMatchObject({ schemaVersion: 1 });
  });
});
