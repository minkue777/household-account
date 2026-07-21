import type {
  FirebaseSdkCompatibilityPair,
  FirebaseWorkerEmittedFile,
} from "../../../domain/model/firebaseWorkerBuild";

export interface FirebaseWorkerArtifactEmitterPort {
  emitIntegratedWorker(
    input: FirebaseSdkCompatibilityPair & {
      readonly configSourceId: string;
    },
  ): readonly FirebaseWorkerEmittedFile[];
}
