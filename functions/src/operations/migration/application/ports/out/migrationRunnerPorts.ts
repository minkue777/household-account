import type {
  MigrationDocument,
  MigrationPlan,
} from "../../../domain/migrationPlan";

export interface MigrationDocumentStore {
  list(): Promise<readonly MigrationDocument[]>;
  applyPage(input: {
    readonly migrationId: string;
    readonly documentIds: readonly string[];
    readonly fromSchemaVersion: number;
    readonly toSchemaVersion: number;
  }): Promise<
    | { readonly kind: "success" }
    | { readonly kind: "retryable-failure" }
  >;
}

export interface MigrationPlanStore {
  save(plan: MigrationPlan): Promise<void>;
  find(planHash: string): Promise<MigrationPlan | undefined>;
}

export interface MigrationHasher {
  hash(material: string): string;
}
