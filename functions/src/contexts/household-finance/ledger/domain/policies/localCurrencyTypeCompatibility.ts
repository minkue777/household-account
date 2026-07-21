export function areLocalCurrencyTypesCompatible(
  values: readonly (string | undefined)[],
): boolean {
  return new Set(values.map((value) => value ?? "__untyped__")).size <= 1;
}

export function isSelectableLocalCurrencyType(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return (
    normalized.length > 0 &&
    normalized !== "all" &&
    normalized !== "legacy-unknown"
  );
}
