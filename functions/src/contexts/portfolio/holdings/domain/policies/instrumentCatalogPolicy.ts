import type {
  CatalogManifest,
  CatalogSnapshot,
} from "../model/instrumentCatalog";
import type { CatalogInstrument } from "../model/instrumentSearch";

export type CatalogValidationResult =
  | { kind: "valid"; items: readonly CatalogInstrument[] }
  | { kind: "invalid"; code: string };

export function validateCatalogSources(input: {
  domestic: readonly CatalogInstrument[];
  us: readonly CatalogInstrument[];
  minimumDomestic: number;
  minimumUs: number;
}): CatalogValidationResult {
  if (
    input.domestic.length < input.minimumDomestic ||
    input.us.length < input.minimumUs
  ) {
    return { kind: "invalid", code: "SOURCE_COUNT_BELOW_MINIMUM" };
  }

  const items = [...input.domestic, ...input.us];
  const identities = new Set<string>();
  for (const item of items) {
    const identity = `${item.market}:${item.code.toLocaleUpperCase()}`;
    if (identities.has(identity)) {
      return { kind: "invalid", code: "DUPLICATE_INSTRUMENT" };
    }
    identities.add(identity);
  }

  return { kind: "valid", items };
}

export function snapshotMatchesManifest(
  snapshot: CatalogSnapshot,
  manifest: CatalogManifest,
): boolean {
  return (
    snapshot.schemaVersion === manifest.schemaVersion &&
    snapshot.catalogVersion === manifest.catalogVersion &&
    snapshot.asOfDate === manifest.asOfDate &&
    snapshot.objectPath === manifest.snapshotObject &&
    snapshot.objectGeneration === manifest.snapshotGeneration &&
    snapshot.checksum === manifest.sha256 &&
    snapshot.itemCount === manifest.itemCount &&
    snapshot.items.length === manifest.itemCount
  );
}
