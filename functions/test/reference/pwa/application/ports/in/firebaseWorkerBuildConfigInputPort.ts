import type {
  FirebasePublicBuildConfig,
  FirebaseSdkCompatibilityPair,
  FirebaseWorkerBuildArtifact,
  FirebaseWorkerBuildFailureCode,
  FirebaseWorkerBuildInput,
  FirebaseWorkerBuildResult,
  FirebaseWorkerBuildState,
  FirebaseWorkerEmittedFile,
} from "../../../domain/model/firebaseWorkerBuild";

export type {
  FirebasePublicBuildConfig,
  FirebaseSdkCompatibilityPair,
  FirebaseWorkerBuildArtifact,
  FirebaseWorkerBuildFailureCode,
  FirebaseWorkerBuildInput,
  FirebaseWorkerBuildResult,
  FirebaseWorkerBuildState,
  FirebaseWorkerEmittedFile,
};

export interface FirebaseWorkerBuildConfigInputPort {
  build(input: FirebaseWorkerBuildInput): FirebaseWorkerBuildResult;
  state(): FirebaseWorkerBuildState;
}
