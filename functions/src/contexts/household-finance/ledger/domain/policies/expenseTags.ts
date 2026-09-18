export const MAX_EXPENSE_TAGS = 10;
export const MAX_EXPENSE_TAG_LENGTH = 30;

export type ExpenseTagsValidation =
  | { kind: "valid"; tags: string[] }
  | { kind: "validation-error"; code: "TAGS_INVALID" | "TAG_TOO_LONG" | "TOO_MANY_TAGS" };

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags
    .map((tag) => tag.trim().replace(/^#+/, "").trim())
    .filter((tag) => tag !== ""))];
}

/** Missing tags are compatible with transactions recorded before tags existed. */
export function validateExpenseTags(value: unknown): ExpenseTagsValidation {
  if (value === undefined) return { kind: "valid", tags: [] };
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    return { kind: "validation-error", code: "TAGS_INVALID" };
  }
  const tags = normalizeTags(value as string[]);
  if (tags.some((tag) => [...tag].length > MAX_EXPENSE_TAG_LENGTH)) {
    return { kind: "validation-error", code: "TAG_TOO_LONG" };
  }
  if (tags.length > MAX_EXPENSE_TAGS) {
    return { kind: "validation-error", code: "TOO_MANY_TAGS" };
  }
  return { kind: "valid", tags };
}

export function readExpenseTags(value: unknown): string[] {
  // Input limits must not erase persisted tags when an older client edits
  // another field, or when stored data was written under different limits.
  return Array.isArray(value)
    ? normalizeTags(value.filter((tag): tag is string => typeof tag === "string"))
    : [];
}
