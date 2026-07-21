export interface StoredCategoryView {
  readonly categoryId: string;
  readonly displayState: "known" | "unknown" | "legacy-default";
}

export function mapStoredCategory(input: {
  readonly storedValue?: string;
  readonly source: "web" | "android" | "legacy";
  readonly knownCategoryIds: readonly string[];
}): StoredCategoryView {
  if (input.storedValue === undefined || input.storedValue.trim() === "") {
    return { categoryId: "etc", displayState: "legacy-default" };
  }

  const raw = input.storedValue.trim();
  const categoryId = input.source === "android" ? raw.toLowerCase() : raw;
  return {
    categoryId,
    displayState: input.knownCategoryIds.includes(categoryId)
      ? "known"
      : "unknown",
  };
}
