import type { HouseholdQueryHandler } from "./householdQuery";

/** contracts/fixtures/system/household-query-manifest.v1.json의 런타임 사본입니다. */
export const HOUSEHOLD_QUERY_NAMES = Object.freeze([
  "ledger.get-transaction.v1",
  "ledger.list-transactions.v1",
  "shortcut.get-credential-status.v1",
  "portfolio.search-instruments.v1",
  "portfolio.get-instrument-quote.v1",
  "portfolio.get-dividend-projection.v1",
  "access.list-asset-owner-profiles.v1",
] as const);

export type HouseholdQueryName = (typeof HOUSEHOLD_QUERY_NAMES)[number];

export function createManifestBackedHouseholdQueryRegistry(
  implemented: Iterable<readonly [string, HouseholdQueryHandler]>,
): ReadonlyMap<string, HouseholdQueryHandler> {
  const publicNames = new Set<string>(HOUSEHOLD_QUERY_NAMES);
  const registry = new Map<string, HouseholdQueryHandler>();
  for (const [name, handler] of implemented) {
    if (!publicNames.has(name)) {
      throw new Error(`Query handler is missing from the public manifest: ${name}`);
    }
    if (registry.has(name)) {
      throw new Error(`Query handler is registered more than once: ${name}`);
    }
    registry.set(name, handler);
  }
  const missing = HOUSEHOLD_QUERY_NAMES.filter((name) => !registry.has(name));
  if (missing.length > 0) {
    throw new Error(`Public query handlers are missing: ${missing.join(", ")}`);
  }
  return registry;
}
