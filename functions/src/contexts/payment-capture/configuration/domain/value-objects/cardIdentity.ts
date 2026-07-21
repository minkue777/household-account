const NUMBERLESS_QUICK_PAYMENT_LABELS = new Set([
  "네이버페이",
  "카카오페이",
  "토스",
]);

export function normalizeCardCompanyKey(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("ko-KR");

  if (
    normalized === "여민전" ||
    normalized === "세종" ||
    normalized === "세종지역화폐"
  ) {
    return "세종지역화폐";
  }

  return normalized;
}

export function canonicalCardCompanyLabel(value: string): string {
  return normalizeCardCompanyKey(value) === "세종지역화폐"
    ? "세종지역화폐"
    : value.trim();
}

export function normalizeRegisteredLastFour(
  value: string,
): string | undefined {
  const normalized = value.replace(/\D/g, "").slice(-4);
  return normalized.length === 4 ? normalized : undefined;
}

export function normalizeMaskedCardToken(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  const normalized = value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[＊*]/g, "x")
    .replace(/[^0-9x]/g, "")
    .slice(-4);

  return normalized.length === 4 ? normalized : undefined;
}

export function maskedCardTokenMatches(
  lastFour: string,
  maskedToken: string,
): boolean {
  if (lastFour.length !== maskedToken.length) return false;

  return [...lastFour].every((digit, index) => {
    const evidence = maskedToken[index];
    return evidence === "x" || evidence === digit;
  });
}

export function isNumberlessQuickPaymentCompany(value: string): boolean {
  return NUMBERLESS_QUICK_PAYMENT_LABELS.has(normalizeCardCompanyKey(value));
}
