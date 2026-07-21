export function normalizeMerchantText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export function normalizedMerchantKeywordTokens(
  keyword: string,
): readonly string[] {
  return keyword.split(",").map(normalizeMerchantText);
}
