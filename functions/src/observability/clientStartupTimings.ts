const STARTUP_TIMING_KEYS = new Set([
  "navigationResponseEnd",
  "bootstrapStarted",
  "authStarted",
  "authReady",
  "membershipStarted",
  "membershipReady",
  "sessionReady",
  "ledgerRequested",
  "ledgerReady",
  "categoriesRequested",
  "categoriesReady",
  "localCurrencyRequested",
  "localCurrencyReady",
  "firstLedgerPaint",
  "firstHomeCompletePaint",
]);

/** Web Navigation 시작부터의 시각만 허용하며 식별자나 URL은 받지 않습니다. */
export function parseClientStartupTimingsMs(
  value: unknown,
): Readonly<Record<string, number>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  if (
    entries.length > STARTUP_TIMING_KEYS.size ||
    entries.some(([key, timing]) =>
      !STARTUP_TIMING_KEYS.has(key) ||
      typeof timing !== "number" ||
      !Number.isFinite(timing) ||
      timing < 0 ||
      timing > 120_000,
    )
  ) {
    return undefined;
  }
  return Object.fromEntries(entries.map(([key, timing]) => [
    key,
    Math.round((timing as number) * 1_000) / 1_000,
  ]));
}
