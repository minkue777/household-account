export interface MigrationDocument {
  readonly documentId: string;
  readonly householdId?: string;
  readonly schemaVersion: number;
}

export interface MigrationPlan {
  readonly migrationId: string;
  readonly scope: {
    readonly householdId: string;
    readonly fromSchemaVersion: number;
  };
  readonly plannedDocumentIds: readonly string[];
  readonly planHash: string;
  readonly beforeHash: string;
}

export type MigrationResult =
  | { readonly kind: "dry-run"; readonly plan: Omit<MigrationPlan, "beforeHash"> }
  | {
      readonly kind: "applied";
      readonly planHash: string;
      readonly migratedDocumentIds: readonly string[];
      readonly reconciliation: {
        readonly plannedCount: number;
        readonly migratedCount: number;
        readonly remainingCount: number;
        readonly beforeHash: string;
        readonly afterHash: string;
      };
    }
  | { readonly kind: "forbidden"; readonly code: string }
  | { readonly kind: "conflict"; readonly code: string }
  | {
      readonly kind: "retryable-failure";
      readonly code: string;
      readonly checkpoint?: string;
    };

export function selectMigrationDocuments(input: {
  readonly documents: readonly MigrationDocument[];
  readonly householdId: string;
  readonly fromSchemaVersion: number;
}): readonly MigrationDocument[] {
  return input.documents
    .filter(
      (document) =>
        document.householdId === input.householdId &&
        document.schemaVersion === input.fromSchemaVersion,
    )
    .sort((left, right) => left.documentId.localeCompare(right.documentId));
}

export function migrationPlanMaterial(input: {
  readonly migrationId: string;
  readonly householdId: string;
  readonly fromSchemaVersion: number;
  readonly documents: readonly MigrationDocument[];
}): string {
  return JSON.stringify({
    migrationId: input.migrationId,
    householdId: input.householdId,
    fromSchemaVersion: input.fromSchemaVersion,
    documents: input.documents.map((document) => [
      document.documentId,
      document.schemaVersion,
    ]),
  });
}
