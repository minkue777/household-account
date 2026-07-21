import type { CatalogInstrument } from "./instrumentSearch";

export interface CatalogSnapshot {
  schemaVersion: 1;
  asOfDate: string;
  catalogVersion: string;
  objectPath: string;
  objectGeneration: string;
  checksum: string;
  itemCount: number;
  items: readonly CatalogInstrument[];
}

export interface CatalogSourceMetadata {
  provider: string;
  asOfDate: string;
  itemCount: number;
}

export interface CatalogManifest {
  schemaVersion: 1;
  catalogVersion: string;
  snapshotObject: string;
  snapshotGeneration: string;
  asOfDate: string;
  publishedAt: string;
  sha256: string;
  itemCount: number;
  sources: readonly CatalogSourceMetadata[];
  manifestGeneration: string;
}

export type CatalogSourceResult =
  | { kind: "success"; items: readonly CatalogInstrument[] }
  | {
      kind: "retryable-failure" | "contract-failure" | "invalid-data";
      code: string;
    };

export interface CatalogRunData {
  domesticSource: CatalogSourceResult;
  usSource: CatalogSourceResult;
  uploadVerification?: "valid" | "checksum-mismatch" | "metadata-mismatch";
  expectedManifestGeneration?: string;
}

export interface PublishCatalogCommand {
  runId: string;
  asOfDate: string;
}

export type PublishCatalogResult =
  | { kind: "published"; manifest: CatalogManifest }
  | {
      kind: "partial-failure" | "retryable-failure" | "contract-failure";
      code: string;
    };

export interface ReadCatalogQuery {
  now: string;
}

export type ReadCatalogResult =
  | {
      kind: "success";
      snapshot: CatalogSnapshot;
      manifestGeneration: string;
      stale: boolean;
    }
  | { kind: "retryable-failure"; code: "CATALOG_UNAVAILABLE" };

export interface CatalogPublicationState {
  latest?: CatalogManifest;
  successfulSnapshots: readonly CatalogSnapshot[];
}
