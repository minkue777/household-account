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
  const androidCategoryEnums: Readonly<Record<string, string>> = {
    LIVING: "living", CHILDCARE: "childcare", FIXED: "fixed", FOOD: "food", ETC: "etc",
  };
  const categoryId = input.source === "android" && Object.prototype.hasOwnProperty.call(androidCategoryEnums, raw)
    ? androidCategoryEnums[raw]! : raw;
  return {
    categoryId,
    displayState: input.knownCategoryIds.includes(categoryId)
      ? "known"
      : "unknown",
  };
}
