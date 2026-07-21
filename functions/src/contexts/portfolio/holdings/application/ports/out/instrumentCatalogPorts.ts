import type {
  CatalogManifest,
  CatalogPublicationState,
  CatalogRunData,
  CatalogSnapshot,
  PublishCatalogResult,
} from "../../../domain/model/instrumentCatalog";

export interface InstrumentCatalogRunSource {
  load(asOfDate: string): Promise<CatalogRunData | undefined>;
}

export interface CatalogPublicationStore {
  findReceipt(runId: string): Promise<PublishCatalogResult | undefined>;
  state(): Promise<CatalogPublicationState>;
  commit(input: {
    runId: string;
    expectedManifestGeneration?: string;
    snapshot: CatalogSnapshot;
    manifest: CatalogManifest;
    receipt: PublishCatalogResult;
    retainSuccessfulDays: number;
  }): Promise<
    | "generation-conflict"
    | { readonly kind: "committed"; readonly manifest: CatalogManifest }
  >;
}

export type CatalogStorageRead<T> =
  | { kind: "available"; value: T }
  | { kind: "unavailable" };

export interface CatalogReadStore {
  readManifest(): Promise<CatalogStorageRead<CatalogManifest>>;
  readSnapshot(
    manifest: CatalogManifest,
  ): Promise<CatalogStorageRead<CatalogSnapshot>>;
}
