export const MAX_EXPENSE_TAGS = 10;
export const MAX_EXPENSE_TAG_LENGTH = 30;

/** Keep tag spelling intact while accepting the # prefix used in the UI. */
export function normalizeExpenseTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) return [];
  return Array.from(new Set((value as string[])
    .map((tag) => tag.trim().replace(/^#+/, '').trim())
    .filter((tag) => tag !== '')));
}
