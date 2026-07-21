import type {
  CatalogManifest,
  CatalogSnapshot,
  PublishCatalogResult,
  ReadCatalogResult,
} from "../domain/model/instrumentCatalog";
import {
  buildCatalogPublication,
  snapshotMatchesManifest,
  validateCatalogSources,
} from "../domain/policies/instrumentCatalogPolicy";
import type { InstrumentCatalog } from "./ports/in/instrumentCatalog";
import type {
  CatalogPublicationStore,
  CatalogReadStore,
  InstrumentCatalogRunSource,
} from "./ports/out/instrumentCatalogPorts";

const CACHE_TTL_MILLISECONDS = 5 * 60 * 1_000;

interface CacheEntry {
  snapshot: CatalogSnapshot;
  manifest: CatalogManifest;
  checkedAt: number;
}

function sourceFailure(
  domesticKind: string,
  usKind: string,
  code: string,
): PublishCatalogResult {
  if (domesticKind === "retryable-failure" || usKind === "retryable-failure") {
    return { kind: "retryable-failure", code };
  }
  if (domesticKind === "success" || usKind === "success") {
    return { kind: "partial-failure", code };
  }
  return { kind: "contract-failure", code };
}

export function createInstrumentCatalogApplication(dependencies: {
  runSource: InstrumentCatalogRunSource;
  publicationStore: CatalogPublicationStore;
  readStore: CatalogReadStore;
  minimumSourceCounts: { domestic: number; us: number };
}): InstrumentCatalog {
  let cache: CacheEntry | undefined;

  return {
    async publish(command) {
      const receipt = await dependencies.publicationStore.findReceipt(command.runId);
      if (receipt !== undefined) return receipt;

      const run = await dependencies.runSource.load(command.asOfDate);
      if (run === undefined) {
        return { kind: "retryable-failure", code: "CATALOG_RUN_UNAVAILABLE" };
      }
      if (
        run.domesticSource.kind !== "success" ||
        run.usSource.kind !== "success"
      ) {
        const failed =
          run.domesticSource.kind !== "success"
            ? run.domesticSource
            : run.usSource.kind !== "success"
              ? run.usSource
              : undefined;
        return sourceFailure(
          run.domesticSource.kind,
          run.usSource.kind,
          failed?.code ?? "CATALOG_SOURCE_FAILURE",
        );
      }

      const validation = validateCatalogSources({
        domestic: run.domesticSource.items,
        us: run.usSource.items,
        minimumDomestic: dependencies.minimumSourceCounts.domestic,
        minimumUs: dependencies.minimumSourceCounts.us,
      });
      if (validation.kind === "invalid") {
        return { kind: "contract-failure", code: validation.code };
      }
      if ((run.uploadVerification ?? "valid") !== "valid") {
        return { kind: "contract-failure", code: "SNAPSHOT_VERIFICATION_FAILED" };
      }

      const publication = buildCatalogPublication({
        asOfDate: command.asOfDate,
        items: validation.items,
        domesticCount: run.domesticSource.items.length,
        usCount: run.usSource.items.length,
      });
      const result: PublishCatalogResult = {
        kind: "published",
        manifest: publication.manifest,
      };
      const committed = await dependencies.publicationStore.commit({
        runId: command.runId,
        expectedManifestGeneration: run.expectedManifestGeneration,
        snapshot: publication.snapshot,
        manifest: publication.manifest,
        receipt: result,
        retainSuccessfulDays: 3,
      });
      if (committed === "generation-conflict") {
        return { kind: "contract-failure", code: "MANIFEST_GENERATION_CONFLICT" };
      }
      return { kind: "published", manifest: committed.manifest };
    },

    async read(query): Promise<ReadCatalogResult> {
      const now = Date.parse(query.now);
      if (
        cache !== undefined &&
        Number.isFinite(now) &&
        now - cache.checkedAt < CACHE_TTL_MILLISECONDS
      ) {
        return {
          kind: "success",
          snapshot: cache.snapshot,
          manifestGeneration: cache.manifest.manifestGeneration,
          stale: false,
        };
      }

      const manifestRead = await dependencies.readStore.readManifest();
      if (manifestRead.kind === "unavailable") {
        return cache === undefined
          ? { kind: "retryable-failure", code: "CATALOG_UNAVAILABLE" }
          : {
              kind: "success",
              snapshot: cache.snapshot,
              manifestGeneration: cache.manifest.manifestGeneration,
              stale: true,
            };
      }

      if (
        cache !== undefined &&
        manifestRead.value.manifestGeneration ===
          cache.manifest.manifestGeneration
      ) {
        cache = {
          ...cache,
          checkedAt: now,
        };
        return {
          kind: "success",
          snapshot: cache.snapshot,
          manifestGeneration: cache.manifest.manifestGeneration,
          stale: false,
        };
      }

      const snapshotRead = await dependencies.readStore.readSnapshot(
        manifestRead.value,
      );
      if (
        snapshotRead.kind === "unavailable" ||
        !snapshotMatchesManifest(snapshotRead.value, manifestRead.value)
      ) {
        return cache === undefined
          ? { kind: "retryable-failure", code: "CATALOG_UNAVAILABLE" }
          : {
              kind: "success",
              snapshot: cache.snapshot,
              manifestGeneration: cache.manifest.manifestGeneration,
              stale: true,
            };
      }

      cache = {
        snapshot: snapshotRead.value,
        manifest: manifestRead.value,
        checkedAt: now,
      };
      return {
        kind: "success",
        snapshot: cache.snapshot,
        manifestGeneration: cache.manifest.manifestGeneration,
        stale: false,
      };
    },

    publicationState: () => dependencies.publicationStore.state(),
  };
}
