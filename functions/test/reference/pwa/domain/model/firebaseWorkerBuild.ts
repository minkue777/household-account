export interface FirebasePublicBuildConfig {
  readonly projectId: string;
  readonly appId: string;
  readonly messagingSenderId: string;
  readonly apiKey: string;
}

export interface FirebaseSdkCompatibilityPair {
  readonly appSdkVersion: string;
  readonly workerMessagingSdkVersion: string;
}

export interface FirebaseWorkerBuildInput
  extends FirebaseSdkCompatibilityPair {
  readonly configSourceId: string;
  readonly publicConfig: FirebasePublicBuildConfig;
  readonly workerConfigOverride?: FirebasePublicBuildConfig;
}

export interface FirebaseWorkerEmittedFile {
  readonly path: string;
  readonly contents: string;
}

export interface FirebaseWorkerBuildArtifact
  extends FirebaseSdkCompatibilityPair {
  readonly webConfig: FirebasePublicBuildConfig;
  readonly workerConfig: FirebasePublicBuildConfig;
  readonly configSourceId: string;
  readonly emittedFiles: readonly FirebaseWorkerEmittedFile[];
}

export type FirebaseWorkerBuildFailureCode =
  | "FIREBASE_CONFIG_DRIFT"
  | "FIREBASE_SDK_INCOMPATIBLE"
  | "WORKER_ARTIFACT_UNSAFE";

export type FirebaseWorkerBuildResult =
  | {
      readonly kind: "Built";
      readonly artifact: FirebaseWorkerBuildArtifact;
    }
  | {
      readonly kind: "BuildFailed";
      readonly code: FirebaseWorkerBuildFailureCode;
    };

export interface FirebaseWorkerBuildState {
  readonly artifacts: readonly {
    readonly configSourceId: string;
    readonly projectId: string;
  }[];
}
