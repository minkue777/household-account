import type { ShortcutValueNormalizationResult } from "../model/shortcutValueNormalization";

const PREFERRED_TEXT_KEYS = [
  "string",
  "text",
  "value",
  "plainText",
  "PlainText",
] as const;

type InternalNormalization =
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "empty" }
  | { readonly kind: "invalid" };

function stableJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): unknown {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined;
  }
  if (typeof value === "bigint") {
    throw new TypeError("BigInt는 Shortcut JSON 값이 아닙니다.");
  }
  if (ancestors.has(value)) {
    throw new TypeError("순환 Shortcut 값은 정규화할 수 없습니다.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => stableJsonValue(entry, ancestors));
    }

    const record = value as Record<string, unknown>;
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      canonical[key] = stableJsonValue(record[key], ancestors);
    }
    return canonical;
  } finally {
    ancestors.delete(value);
  }
}

function normalizeInternal(
  value: unknown,
  ancestors: WeakSet<object>,
): InternalNormalization {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized === ""
      ? { kind: "empty" }
      : { kind: "value", value: normalized };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { kind: "value", value: String(value) };
  }
  if (value === null || value === undefined) return { kind: "empty" };
  if (typeof value !== "object") return { kind: "empty" };
  if (ancestors.has(value)) return { kind: "invalid" };

  if (Array.isArray(value)) {
    ancestors.add(value);
    try {
      const entries: string[] = [];
      for (const item of value) {
        const normalized = normalizeInternal(item, ancestors);
        if (normalized.kind === "invalid") return normalized;
        if (normalized.kind === "value") entries.push(normalized.value);
      }
      return entries.length === 0
        ? { kind: "empty" }
        : { kind: "value", value: entries.join("\n") };
    } finally {
      ancestors.delete(value);
    }
  }

  const record = value as Record<string, unknown>;
  for (const key of PREFERRED_TEXT_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return { kind: "value", value: candidate.trim() };
    }
  }

  try {
    const serialized = JSON.stringify(stableJsonValue(value, ancestors));
    return serialized === undefined || serialized === ""
      ? { kind: "empty" }
      : { kind: "value", value: serialized };
  } catch {
    return { kind: "invalid" };
  }
}

export function normalizeShortcutValue(
  value: unknown,
): ShortcutValueNormalizationResult {
  const normalized = normalizeInternal(value, new WeakSet<object>());
  return normalized.kind === "value"
    ? { kind: "Normalized", value: normalized.value }
    : { kind: "Empty" };
}
