const ANDROID_CATEGORY_ENUMS: Readonly<Record<string, string>> = {
  LIVING: 'living', CHILDCARE: 'childcare', FIXED: 'fixed', FOOD: 'food', ETC: 'etc',
};

export function normalizeStoredCategoryId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'etc';
  const raw = value.trim();
  return Object.prototype.hasOwnProperty.call(ANDROID_CATEGORY_ENUMS, raw) ? ANDROID_CATEGORY_ENUMS[raw] : raw;
}
