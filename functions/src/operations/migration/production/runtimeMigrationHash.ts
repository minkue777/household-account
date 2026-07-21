import { createHash } from "node:crypto";

function normalized(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate(): Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (Array.isArray(value)) return value.map(normalized);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalized(entry)]),
  );
}

export function stableMigrationMaterial(value: unknown): string {
  return JSON.stringify(normalized(value));
}

export function runtimeMigrationHash(value: unknown): string {
  return createHash("sha256")
    .update(stableMigrationMaterial(value), "utf8")
    .digest("hex");
}

export function runtimeMigrationCheckpoint(
  planHash: string,
  nextIndex: number,
): string {
  return `${planHash}:${nextIndex}`;
}

export function safeIntegerAmount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : 0;
}

export function runtimeMigrationCandidateDecisionHash(input: {
  readonly sourcePath: string;
  readonly sourceFingerprint: string;
  readonly targetPath: string;
  readonly targetData: Readonly<Record<string, unknown>>;
  readonly action: string;
  readonly logicalCollection: string;
  readonly amountInWon: number;
}): string {
  return runtimeMigrationHash(input);
}
