import { createInstrumentCatalogApplication } from "../../src/contexts/portfolio/holdings/application/instrumentCatalogApplication";
import type {
  CatalogPublicationStore,
  CatalogReadStore,
  InstrumentCatalogRunSource,
} from "../../src/contexts/portfolio/holdings/application/ports/out/instrumentCatalogPorts";
import type {
  CatalogInstrument,
  CatalogManifest,
  CatalogPublicationState,
  CatalogSnapshot,
  PublishCatalogResult,
} from "../../src/contexts/portfolio/holdings/public";
import type { CatalogRunData } from "../../src/contexts/portfolio/holdings/domain/model/instrumentCatalog";

interface StorageReadScenario {
  manifest: "available" | "unavailable";
  snapshot: "available" | "unavailable" | "checksum-mismatch";
  visibleManifest?: CatalogManifest;
  visibleSnapshot?: CatalogSnapshot;
}

function cloneSnapshot(snapshot: CatalogSnapshot): CatalogSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map((item) => ({ ...item })),
  };
}

function cloneManifest(manifest: CatalogManifest): CatalogManifest {
  return {
    ...manifest,
    sources: manifest.sources.map((source) => ({ ...source })),
  };
}

function cloneState(state: CatalogPublicationState): CatalogPublicationState {
  return {
    latest: state.latest === undefined ? undefined : cloneManifest(state.latest),
    successfulSnapshots: state.successfulSnapshots.map(cloneSnapshot),
  };
}

export function createInstrumentCatalogFixture(fixture: {
  storage?: CatalogPublicationState;
  minimumSourceCounts: { domestic: number; us: number };
  runs: Readonly<Record<string, CatalogRunData>>;
  legacyStocksJson?: readonly CatalogInstrument[];
}) {
  let state = cloneState(fixture.storage ?? { successfulSnapshots: [] });
  let readScenario: StorageReadScenario = {
    manifest: "available",
    snapshot: "available",
  };
  const receipts = new Map<string, PublishCatalogResult>();

  const runSource: InstrumentCatalogRunSource = {
    load: async (asOfDate) => fixture.runs[asOfDate],
  };
  const publicationStore: CatalogPublicationStore = {
    findReceipt: async (runId) => receipts.get(runId),
    state: async () => cloneState(state),
    commit: async (input) => {
      if (
        input.expectedManifestGeneration !== undefined &&
        input.expectedManifestGeneration !== state.latest?.manifestGeneration
      ) {
        return "generation-conflict";
      }

      const snapshots = state.successfulSnapshots
        .filter(({ asOfDate }) => asOfDate !== input.snapshot.asOfDate)
        .concat(cloneSnapshot(input.snapshot))
        .sort((left, right) => right.asOfDate.localeCompare(left.asOfDate))
        .slice(0, input.retainSuccessfulDays);
      state = {
        latest: cloneManifest(input.manifest),
        successfulSnapshots: snapshots,
      };
      receipts.set(input.runId, input.receipt);
      return { kind: "committed", manifest: cloneManifest(input.manifest) };
    },
  };
  const readStore: CatalogReadStore = {
    readManifest: async () => {
      if (readScenario.manifest === "unavailable") return { kind: "unavailable" };
      const manifest = readScenario.visibleManifest ?? state.latest;
      return manifest === undefined
        ? { kind: "unavailable" }
        : { kind: "available", value: cloneManifest(manifest) };
    },
    readSnapshot: async (manifest) => {
      if (readScenario.snapshot === "unavailable") return { kind: "unavailable" };
      const snapshot =
        readScenario.visibleSnapshot ??
        state.successfulSnapshots.find(
          ({ objectPath }) => objectPath === manifest.snapshotObject,
        );
      if (snapshot === undefined) return { kind: "unavailable" };
      const copy = cloneSnapshot(snapshot);
      if (readScenario.snapshot === "checksum-mismatch") {
        return {
          kind: "available",
          value: { ...copy, checksum: `${copy.checksum}:mismatch` },
        };
      }
      return { kind: "available", value: copy };
    },
  };
  const application = createInstrumentCatalogApplication({
    runSource,
    publicationStore,
    readStore,
    minimumSourceCounts: fixture.minimumSourceCounts,
  });

  return {
    publish: application.publish,
    read: async (command: { now: string; storage: StorageReadScenario }) => {
      readScenario = command.storage;
      return application.read({ now: command.now });
    },
    publicationState: application.publicationState,
  };
}
