import type { CategoryDocument } from '@/types/category';

const CATEGORY_SNAPSHOT_VERSION = 1;
const CATEGORY_SNAPSHOT_PREFIX = 'household-account.categories.v1';

function keyFor(householdId: string): string {
  return `${CATEGORY_SNAPSHOT_PREFIX}:${householdId}`;
}

function isCategory(value: unknown, householdId: string): value is CategoryDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && item.id.trim() !== ''
    && typeof item.key === 'string'
    && item.key.trim() !== ''
    && typeof item.label === 'string'
    && typeof item.color === 'string'
    && (item.budget === null || (typeof item.budget === 'number' && Number.isFinite(item.budget)))
    && Number.isInteger(item.order)
    && typeof item.isDefault === 'boolean'
    && typeof item.isActive === 'boolean'
    && item.householdId === householdId;
}

export function readCategorySnapshot(
  householdId: string
): CategoryDocument[] | undefined {
  if (typeof window === 'undefined' || householdId.trim() === '') return undefined;
  try {
    const raw = window.localStorage.getItem(keyFor(householdId));
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as {
      version?: unknown;
      householdId?: unknown;
      items?: unknown;
    };
    if (
      stored.version !== CATEGORY_SNAPSHOT_VERSION
      || stored.householdId !== householdId
      || !Array.isArray(stored.items)
      || !stored.items.every((item) => isCategory(item, householdId))
    ) {
      return undefined;
    }
    return stored.items.map((item) => ({ ...(item as CategoryDocument) }));
  } catch {
    return undefined;
  }
}

export function writeCategorySnapshot(
  householdId: string,
  categories: readonly CategoryDocument[]
): void {
  if (typeof window === 'undefined' || householdId.trim() === '') return;
  try {
    window.localStorage.setItem(
      keyFor(householdId),
      JSON.stringify({
        version: CATEGORY_SNAPSHOT_VERSION,
        householdId,
        writtenAt: Date.now(),
        items: categories,
      })
    );
  } catch {
    // localStorage 장애는 authoritative 구독을 막지 않습니다.
  }
}
