import type { PwaRootRegistration } from "../../../domain/model/pwaRootRuntime";

export interface PwaProductionWorkerArtifactPort {
  workerArtifactPaths(): readonly string[];
}

export interface PwaRootWorkerRegistrationPort {
  registrations(): readonly PwaRootRegistration[];
  registerIntegratedRootWorker(): Promise<
    | { readonly kind: "Registered"; readonly registration: PwaRootRegistration }
    | { readonly kind: "Failed" }
  >;
  retire(registrationId: string): void;
}

export interface PwaMessagingEndpointPort {
  register(input: { readonly fid: string; readonly memberId: string }): Promise<void>;
  remove(fid: string): Promise<"success" | "failure">;
}

export interface PwaSessionPurgePort {
  purge(sessionGeneration: string): Promise<"success" | "failure">;
}

export interface PwaWorkerVersionPort {
  versions(): {
    readonly activeWorkerVersion: string;
    readonly waitingWorkerVersion?: string;
  };
}
