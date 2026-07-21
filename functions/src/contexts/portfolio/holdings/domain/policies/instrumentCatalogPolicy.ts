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

export function buildCatalogPublication(input: {
  asOfDate: string;
  items: readonly CatalogInstrument[];
  domesticCount: number;
  usCount: number;
}): { snapshot: CatalogSnapshot; manifest: CatalogManifest } {
  const catalogVersion = "v1";
  const objectPath = `market-catalog/${catalogVersion}/snapshots/${input.asOfDate}/${catalogVersion}.json.gz`;
  const objectGeneration = `snapshot-${input.asOfDate}-${catalogVersion}`;
  const checksum = `sha256:${input.asOfDate}:${input.items.length}:${input.items
    .map(({ market, code }) => `${market}:${code}`)
    .join("|")}`;
  const snapshot: CatalogSnapshot = {
    schemaVersion: 1,
    asOfDate: input.asOfDate,
    catalogVersion,
    objectPath,
    objectGeneration,
    checksum,
    itemCount: input.items.length,
    items: input.items.map((item) => ({ ...item })),
  };
  const manifest: CatalogManifest = {
    schemaVersion: 1,
    catalogVersion,
    snapshotObject: objectPath,
    snapshotGeneration: objectGeneration,
    asOfDate: input.asOfDate,
    publishedAt: `${input.asOfDate}T06:00:00+09:00`,
    sha256: checksum,
    itemCount: input.items.length,
    sources: [
      {
        provider: "domestic-catalog",
        asOfDate: input.asOfDate,
        itemCount: input.domesticCount,
      },
      {
        provider: "us-catalog",
        asOfDate: input.asOfDate,
        itemCount: input.usCount,
      },
    ],
    manifestGeneration: `manifest-${input.asOfDate}-${catalogVersion}`,
  };
  return { snapshot, manifest };
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
