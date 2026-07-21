import {
  migrationPlanMaterial,
  selectMigrationDocuments,
  type MigrationPlan,
} from "../domain/migrationPlan";
import type { MigrationRunnerInputPort } from "./ports/in/migrationRunnerInputPort";
import type {
  MigrationDocumentStore,
  MigrationHasher,
  MigrationPlanStore,
} from "./ports/out/migrationRunnerPorts";

function checkpointFor(planHash: string, nextIndex: number): string {
  return `${planHash}:${nextIndex}`;
}

function checkpointIndex(checkpoint: string | undefined, planHash: string): number {
  if (checkpoint === undefined) return 0;
  const prefix = `${planHash}:`;
  if (!checkpoint.startsWith(prefix)) return -1;
  const index = Number(checkpoint.slice(prefix.length));
  return Number.isSafeInteger(index) && index >= 0 ? index : -1;
}

export function createMigrationRunnerApplication(dependencies: {
  readonly documents: MigrationDocumentStore;
  readonly plans: MigrationPlanStore;
  readonly hasher: MigrationHasher;
  readonly pageSize: number;
}): MigrationRunnerInputPort {
  return {
    async run(input) {
      if (input.actor !== "operations") {
        return { kind: "forbidden", code: "OPERATIONS_ACTOR_REQUIRED" };
      }

      if (input.mode === "dry-run") {
        const candidates = selectMigrationDocuments({
          documents: await dependencies.documents.list(),
          householdId: input.householdId,
          fromSchemaVersion: input.fromSchemaVersion,
        });
        const material = migrationPlanMaterial({ ...input, documents: candidates });
        const plan: MigrationPlan = {
          migrationId: input.migrationId,
          scope: {
            householdId: input.householdId,
            fromSchemaVersion: input.fromSchemaVersion,
          },
          plannedDocumentIds: candidates.map((document) => document.documentId),
          planHash: dependencies.hasher.hash(`plan:${material}`),
          beforeHash: dependencies.hasher.hash(`before:${material}`),
        };
        await dependencies.plans.save(plan);
        const { beforeHash: _beforeHash, ...publicPlan } = plan;
        return { kind: "dry-run", plan: publicPlan };
      }

      if (input.expectedPlanHash === undefined) {
        return {
          kind: "conflict",
          code: "MIGRATION_PLAN_RECONCILIATION_MISMATCH",
        };
      }
      const plan = await dependencies.plans.find(input.expectedPlanHash);
      if (
        plan === undefined ||
        plan.migrationId !== input.migrationId ||
        plan.scope.householdId !== input.householdId ||
        plan.scope.fromSchemaVersion !== input.fromSchemaVersion
      ) {
        return {
          kind: "conflict",
          code: "MIGRATION_PLAN_RECONCILIATION_MISMATCH",
        };
      }
      const startIndex = checkpointIndex(input.checkpoint, plan.planHash);
      if (startIndex < 0 || startIndex > plan.plannedDocumentIds.length) {
        return { kind: "conflict", code: "MIGRATION_CHECKPOINT_MISMATCH" };
      }

      for (
        let index = startIndex;
        index < plan.plannedDocumentIds.length;
        index += dependencies.pageSize
      ) {
        const page = plan.plannedDocumentIds.slice(
          index,
          index + dependencies.pageSize,
        );
        const result = await dependencies.documents.applyPage({
          migrationId: plan.migrationId,
          documentIds: page,
          fromSchemaVersion: plan.scope.fromSchemaVersion,
          toSchemaVersion: plan.scope.fromSchemaVersion + 1,
        });
        if (result.kind === "retryable-failure") {
          return {
            kind: "retryable-failure",
            code: "MIGRATION_PAGE_FAILED",
            checkpoint: checkpointFor(plan.planHash, index),
          };
        }
      }

      const afterDocuments = await dependencies.documents.list();
      const remainingCount = afterDocuments.filter(
        (document) =>
          plan.plannedDocumentIds.includes(document.documentId) &&
          document.schemaVersion === plan.scope.fromSchemaVersion,
      ).length;
      const afterMaterial = migrationPlanMaterial({
        migrationId: plan.migrationId,
        householdId: plan.scope.householdId,
        fromSchemaVersion: plan.scope.fromSchemaVersion,
        documents: afterDocuments.filter((document) =>
          plan.plannedDocumentIds.includes(document.documentId),
        ),
      });
      return {
        kind: "applied",
        planHash: plan.planHash,
        migratedDocumentIds: [...plan.plannedDocumentIds],
        reconciliation: {
          plannedCount: plan.plannedDocumentIds.length,
          migratedCount: plan.plannedDocumentIds.length - remainingCount,
          remainingCount,
          beforeHash: plan.beforeHash,
          afterHash: dependencies.hasher.hash(`after:${afterMaterial}`),
        },
      };
    },
  };
}
