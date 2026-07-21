import type { PwaRootRegistration } from "./pwaRootRuntime";

export interface PwaManifestIconMetadata {
  readonly src: string;
  readonly sizes: string;
  readonly purpose?: string;
}

export interface PwaManifestMetadata {
  readonly name?: string;
  readonly shortName?: string;
  readonly display?: string;
  readonly orientation?: string;
  readonly startUrl?: string;
  readonly scope?: string;
  readonly icons: readonly PwaManifestIconMetadata[];
}

export type PwaInstallMetadataFailureCode =
  | "INSTALL_NAME_MISSING"
  | "DISPLAY_NOT_STANDALONE"
  | "ORIENTATION_NOT_PORTRAIT"
  | "INVALID_SCOPE"
  | "INSTALL_ICON_MISSING"
  | "ROOT_WORKER_UNAVAILABLE";

export type PwaBootstrapWorkerRegistration = Pick<
  PwaRootRegistration,
  "scope" | "scriptUrl"
>;

export type PwaBootstrapResult =
  | {
      readonly kind: "Enabled";
      readonly workerRegistrations: readonly PwaBootstrapWorkerRegistration[];
      readonly installability: "installable";
      readonly display: "standalone";
      readonly orientation: "portrait";
    }
  | {
      readonly kind: "DisabledForDevelopment";
      readonly workerRegistrations: readonly [];
    }
  | {
      readonly kind: "ConfigurationRejected";
      readonly code: PwaInstallMetadataFailureCode;
      readonly workerRegistrations: readonly [];
    };
