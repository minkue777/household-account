import {
  runtimeMigrationCheckpoint,
  runtimeMigrationHash,
} from "./runtimeMigrationHash";
import type {
  RuntimeMigrationApplyResult,
  RuntimeMigrationDryRunResult,
  RuntimeMigrationMappingManifest,
  RuntimeMigrationPersistencePort,
  RuntimeMigrationPlanBuilderPort,
  RuntimeMigrationScope,
} from "./runtimeMigrationModel";

export interface RuntimeMigrationApplication {
  dryRun(input: {
    readonly scope: RuntimeMigrationScope;
    readonly mappings: RuntimeMigrationMappingManifest;
    readonly plannedAt: string;
  }): Promise<RuntimeMigrationDryRunResult>;
  apply(input: {
    readonly scope: RuntimeMigrationScope;
    readonly expectedPlanHash: string;
    readonly confirmation: "APPLY" | "MISSING";
    readonly checkpoint?: string;
    readonly pageSize: number;
    readonly maxPages: number;
    readonly appliedAt: string;
  }): Promise<RuntimeMigrationApplyResult>;
}

function sameScope(left: RuntimeMigrationScope, right: RuntimeMigrationScope) {
  return (
    left.projectId === right.projectId &&
    left.householdId === right.householdId &&
    left.migrationId === right.migrationId &&
    left.migrationKind === right.migrationKind &&
    left.schemaScope === right.schemaScope &&
    left.operatorId === right.operatorId
  );
}

export function createRuntimeMigrationApplication(dependencies: {
  readonly builder: RuntimeMigrationPlanBuilderPort;
  readonly persistence: RuntimeMigrationPersistencePort;
}): RuntimeMigrationApplication {
  return {
    async dryRun(input) {
      const material = await dependencies.builder.build(input);
      const planHash = runtimeMigrationHash(material);
      const plan = await dependencies.persistence.persistDryRun({
        material,
        planHash,
        plannedAt: input.plannedAt,
      });
      return {
        kind: "dry-run",
        planHash,
        scopeHash: runtimeMigrationHash(material.scope),
        candidateCount: plan.candidateCount,
        unresolved: material.unresolved,
        sourceSummary: material.sourceSummary,
        expectedTargetSummary: material.expectedTargetSummary,
        checkpoint: plan.checkpoint,
      };
    },

    async apply(input) {
      if (input.confirmation !== "APPLY") {
        return { kind: "blocked", code: "EXPLICIT_CONFIRMATION_REQUIRED" };
      }
      const plan = await dependencies.persistence.loadPlan(
        input.expectedPlanHash,
      );
      if (plan === undefined) {
        return { kind: "blocked", code: "MIGRATION_PLAN_NOT_FOUND" };
      }
      if (plan.planHash !== input.expectedPlanHash) {
        return { kind: "blocked", code: "MIGRATION_PLAN_HASH_MISMATCH" };
      }
      if (!sameScope(plan.scope, input.scope)) {
        return {
          kind: "blocked",
          code: "MIGRATION_SCOPE_MISMATCH",
          planHash: plan.planHash,
        };
      }
      if (
        input.checkpoint !== undefined &&
        input.checkpoint !== plan.checkpoint
      ) {
        return {
          kind: "blocked",
          code: "MIGRATION_CHECKPOINT_MISMATCH",
          planHash: plan.planHash,
          checkpoint: plan.checkpoint,
        };
      }
      if (plan.unresolvedCount > 0) {
        return {
          kind: "blocked",
          code: "MIGRATION_UNRESOLVED_REFERENCES",
          planHash: plan.planHash,
          checkpoint: plan.checkpoint,
          unresolved: await dependencies.persistence.loadUnresolved(
            plan.planHash,
          ),
        };
      }

      let current = plan;
      let appliedPages = 0;
      let replayedPages = 0;
      const pageSize = Math.min(100, Math.max(1, input.pageSize));
      const maxPages = Math.min(10_000, Math.max(1, input.maxPages));
      while (
        current.nextIndex < current.candidateCount &&
        appliedPages + replayedPages < maxPages
      ) {
        const result = await dependencies.persistence.applyNextPage({
          plan: current,
          pageSize,
          appliedAt: input.appliedAt,
        });
        if (result.kind === "blocked") {
          return {
            kind: "blocked",
            code: result.code,
            planHash: current.planHash,
            checkpoint: result.checkpoint,
          };
        }
        current = result.plan;
        if (result.kind === "page-applied") appliedPages += 1;
        else replayedPages += 1;
      }

      if (current.nextIndex < current.candidateCount) {
        return {
          kind: "checkpoint",
          planHash: current.planHash,
          checkpoint: current.checkpoint,
          appliedPages,
          replayedPages,
          remainingCandidates: current.candidateCount - current.nextIndex,
        };
      }
      const reconciliation = await dependencies.persistence.reconcile(current);
      if (reconciliation.kind === "mismatch") {
        return {
          kind: "blocked",
          code: "MIGRATION_RECONCILIATION_MISMATCH",
          planHash: current.planHash,
          checkpoint: runtimeMigrationCheckpoint(
            current.planHash,
            current.nextIndex,
          ),
        };
      }
      return {
        kind: "applied",
        planHash: current.planHash,
        checkpoint: reconciliation.plan.checkpoint,
        appliedPages,
        replayedPages,
        reconciliation: {
          source: current.sourceSummary,
          expectedTarget: current.expectedTargetSummary,
          actualTarget: reconciliation.actual,
          status: "MATCH",
        },
      };
    },
  };
}
