import { createHash } from "node:crypto";

export function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function text(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
  fallback = "",
): string {
  const candidate = value?.[field];
  return typeof candidate === "string" ? candidate.trim() : fallback;
}

export function optionalText(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
): string | undefined {
  const candidate = text(value, field);
  return candidate === "" ? undefined : candidate;
}

export function finite(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
  fallback = 0,
): number {
  const candidate = value?.[field];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : fallback;
}

export function safeWon(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
  fallback = 0,
): number {
  return Math.max(0, Math.round(Math.abs(finite(value, field, fallback))));
}

export function safeVersion(
  value: FirebaseFirestore.DocumentData | undefined,
  field = "aggregateVersion",
): number {
  const candidate = finite(value, field, 1);
  return Number.isSafeInteger(candidate) && candidate >= 1 ? candidate : 1;
}

export function iso(
  value: unknown,
  fallback = "1970-01-01T00:00:00.000Z",
): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
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
