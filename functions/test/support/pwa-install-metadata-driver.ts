import { createPwaInstallMetadataApplication } from "../reference/pwa/application/pwaInstallMetadataApplication";
import type { PwaInstallMetadataInputPort } from "../reference/pwa/public";
import {
  createPwaRootRuntimeDriver,
  type PwaRootRuntimeFixture,
} from "./pwa-root-runtime-driver";

export type {
  PwaBootstrapResult,
  PwaBootstrapWorkerRegistration,
  PwaInstallMetadataFailureCode,
  PwaManifestIconMetadata,
  PwaManifestMetadata,
} from "../reference/pwa/public";

export interface PwaInstallMetadataFixture {
  readonly rootRuntime?: PwaRootRuntimeFixture;
}

export interface PwaInstallMetadataDriver extends PwaInstallMetadataInputPort {}

export function createPwaInstallMetadataDriver(
  fixture: PwaInstallMetadataFixture = {},
): PwaInstallMetadataDriver {
  return createPwaInstallMetadataApplication({
    rootRuntime: createPwaRootRuntimeDriver(fixture.rootRuntime),
  });
}
