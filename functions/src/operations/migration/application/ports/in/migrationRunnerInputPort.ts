import type { MigrationResult } from "../../../domain/migrationPlan";

export interface RunMigrationInput {
  readonly actor: "operations" | "client";
  readonly migrationId: string;
  readonly householdId: string;
  readonly fromSchemaVersion: number;
  readonly mode: "dry-run" | "apply";
  readonly expectedPlanHash?: string;
  readonly checkpoint?: string;
}

export interface MigrationRunnerInputPort {
  run(input: RunMigrationInput): Promise<MigrationResult>;
}
