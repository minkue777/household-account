import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";

import {
  runtimeMigrationHash,
  stableMigrationMaterial,
} from "../../../../operations/migration/public";
import type {
  RuntimeMigrationCandidate,
  RuntimeMigrationMappingManifest,
  RuntimeMigrationScope,
  RuntimeMigrationUnresolved,
} from "../../../../operations/migration/public";

export type MigrationDocumentData = FirebaseFirestore.DocumentData;
export type MigrationSourceSnapshot =
  | firestore.QueryDocumentSnapshot
  | firestore.DocumentSnapshot;

export interface RuntimeMigrationCandidateDraft {
  readonly sourcePath: string;
  readonly sourceFingerprint: string;
  readonly targetPath: string;
  readonly targetData: Readonly<Record<string, unknown>>;
  readonly action: RuntimeMigrationCandidate["action"];
  readonly amountInWon: number;
  readonly sourceAmountInWon: number;
  readonly logicalCollection: RuntimeMigrationCandidate["logicalCollection"];
}

export interface RuntimeMigrationCollectorResult {
  readonly drafts: readonly RuntimeMigrationCandidateDraft[];
  readonly unresolved: readonly RuntimeMigrationUnresolved[];
}

export type RuntimeMigrationCollectorIssue = RuntimeMigrationUnresolved;

export interface RuntimeMigrationCollectorScope {
  readonly scope: RuntimeMigrationScope;
  readonly mappings: RuntimeMigrationMappingManifest;
  readonly plannedAt: string;
  readonly householdPath: string;
}

export function rawSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function text(
  data: MigrationDocumentData | undefined,
  ...fields: string[]
): string {
  for (const field of fields) {
    const candidate = data?.[field];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }
  return "";
}

export function numberValue(
  data: MigrationDocumentData | undefined,
  fallback: number,
  ...fields: string[]
): number {
  for (const field of fields) {
    const candidate = data?.[field];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return fallback;
}

export function positiveInteger(
  data: MigrationDocumentData | undefined,
  fallback: number,
  ...fields: string[]
): number {
  const value = numberValue(data, fallback, ...fields);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function iso(value: unknown, fallback: string): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate(): Date }).toDate();
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return fallback;
}

export function sourceFingerprint(snapshot: MigrationSourceSnapshot): string {
  return runtimeMigrationHash({ path: snapshot.ref.path, data: snapshot.data() });
}

export function candidateDraft(
  snapshot: MigrationSourceSnapshot,
  draft: Omit<
    RuntimeMigrationCandidateDraft,
    "sourcePath" | "sourceFingerprint"
  >,
): RuntimeMigrationCandidateDraft {
  return {
    ...draft,
    sourcePath: snapshot.ref.path,
    sourceFingerprint: sourceFingerprint(snapshot),
  };
}

export function migrationIssue(input: {
  code: RuntimeMigrationUnresolved["code"];
  sourceCollection: string;
  reference: string;
  requiredManifestField?: string;
  detailCode?: string;
}): RuntimeMigrationUnresolved {
  return {
    code: input.code,
    sourceCollection: input.sourceCollection,
    referenceHash: runtimeMigrationHash(input.reference).slice(0, 24),
    ...(input.requiredManifestField === undefined
      ? {}
      : { requiredManifestField: input.requiredManifestField }),
    ...(input.detailCode === undefined ? {} : { detailCode: input.detailCode }),
  };
}

export function lifecycle(
  data: MigrationDocumentData,
): "active" | "deleted" {
  return data.lifecycleState === "deleted" ||
    data.lifecycleState === "purging" ||
    data.deletedAt !== undefined ||
    data.isActive === false
    ? "deleted"
    : "active";
}

export function legacySchemaInScope(data: MigrationDocumentData): boolean {
  return data.schemaVersion === undefined || data.schemaVersion === 1;
}

export function nonNegativeWon(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(Math.abs(value)))
    : 0;
}

export function resolveMember(input: {
  raw: string;
  documentId: string;
  explicitByDocument?: Readonly<Record<string, string>>;
  mappings: RuntimeMigrationMappingManifest;
  memberIds: ReadonlySet<string>;
}): string | undefined {
  const explicit = input.explicitByDocument?.[input.documentId];
  if (explicit !== undefined && input.memberIds.has(explicit)) return explicit;
  if (input.raw !== "" && input.memberIds.has(input.raw)) return input.raw;
  const mapped = input.mappings.memberReferences?.[input.raw];
  return mapped !== undefined && input.memberIds.has(mapped) ? mapped : undefined;
}

export function createdAndUpdated(
  data: MigrationDocumentData,
  plannedAt: string,
) {
  const createdAt = iso(data.createdAt, plannedAt);
  return {
    createdAt,
    updatedAt: iso(data.updatedAt, createdAt),
  };
}

export function objectValue(
  data: MigrationDocumentData | undefined,
  field: string,
): Readonly<Record<string, unknown>> {
  const value = data?.[field];
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

export function fieldsMatch(
  actual: MigrationDocumentData | undefined,
  expected: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  return (
    actual !== undefined &&
    fields.every(
      (field) =>
        stableMigrationMaterial(actual[field]) ===
        stableMigrationMaterial(expected[field]),
    )
  );
}
