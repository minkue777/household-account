import type {
  PwaBootstrapResult,
  PwaBootstrapWorkerRegistration,
  PwaInstallMetadataFailureCode,
  PwaManifestIconMetadata,
  PwaManifestMetadata,
} from "../../../domain/model/pwaInstallMetadata";

export type {
  PwaBootstrapResult,
  PwaBootstrapWorkerRegistration,
  PwaInstallMetadataFailureCode,
  PwaManifestIconMetadata,
  PwaManifestMetadata,
};

export interface PwaInstallMetadataInputPort {
  bootstrap(input: {
    readonly environment: "production" | "development";
    readonly manifest: PwaManifestMetadata;
  }): Promise<PwaBootstrapResult>;
}
