import type * as firestore from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import {
  FirebaseInstrumentCatalogStorage,
  RemoteInstrumentCatalogRunSource,
} from "../../adapters/firebase/portfolio/firebaseInstrumentCatalog";
import { createInstrumentCatalogApplication } from "../../contexts/portfolio/holdings/application/instrumentCatalogApplication";
import type { ScheduledFeaturePagePort } from "../../platform/external-operations/application/ports/out/scheduledJobExecutionPorts";

export function createInstrumentCatalogScheduledPages(input: {
  readonly database: firestore.Firestore;
  readonly asOfDate: string;
  readonly runId: string;
}): ScheduledFeaturePagePort {
  const bucket = getStorage().bucket();
  const storage = new FirebaseInstrumentCatalogStorage(input.database, bucket);
  const catalog = createInstrumentCatalogApplication({
    runSource: new RemoteInstrumentCatalogRunSource(bucket),
    publicationStore: storage,
    readStore: storage,
    minimumSourceCounts: { domestic: 3_500, us: 9_000 },
  });

  return {
    async nextPage(checkpoint) {
      if (checkpoint === "catalog:complete") return undefined;
      if (checkpoint !== undefined) throw new Error("CATALOG_CHECKPOINT_INVALID");
      const result = await catalog.publish({
        runId: input.runId,
        asOfDate: input.asOfDate,
      });
      return {
        checkpointAfter: "catalog:complete",
        terminal: true,
        targets: [
          result.kind === "published"
            ? {
                targetId: `catalog:${input.asOfDate}`,
                outcome: {
                  kind: "SUCCEEDED" as const,
                  receipt: `${result.manifest.snapshotGeneration}:${result.manifest.sha256}`,
                },
              }
            : {
                targetId: `catalog:${input.asOfDate}`,
                outcome: {
                  kind: "FAILED" as const,
                  code: result.code,
                  retryable:
                    result.kind === "retryable-failure" ||
                    result.kind === "partial-failure",
                },
              },
        ],
      };
    },
  };
}
