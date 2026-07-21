import type {
  FirebasePublicBuildConfig,
  FirebaseSdkCompatibilityPair,
  FirebaseWorkerBuildArtifact,
  FirebaseWorkerEmittedFile,
} from "../domain/model/firebaseWorkerBuild";
import {
  firebasePublicConfigsMatch,
  isSafeIntegratedFirebaseWorkerArtifact,
  isSupportedFirebaseSdkPair,
} from "../domain/policies/firebaseWorkerBuildPolicy";
import type { FirebaseWorkerBuildConfigInputPort } from "./ports/in/firebaseWorkerBuildConfigInputPort";
import type { FirebaseWorkerArtifactEmitterPort } from "./ports/out/firebaseWorkerArtifactEmitterPort";

function copyConfig(
  config: FirebasePublicBuildConfig,
): FirebasePublicBuildConfig {
  return {
    projectId: config.projectId,
    appId: config.appId,
    messagingSenderId: config.messagingSenderId,
    apiKey: config.apiKey,
  };
}

function copyFiles(
  files: readonly FirebaseWorkerEmittedFile[],
): readonly FirebaseWorkerEmittedFile[] {
  return files.map(({ path, contents }) => ({ path, contents }));
}

export function createFirebaseWorkerBuildConfigApplication(dependencies: {
  readonly supportedSdkPairs: readonly FirebaseSdkCompatibilityPair[];
  readonly artifactEmitter: FirebaseWorkerArtifactEmitterPort;
}): FirebaseWorkerBuildConfigInputPort {
  const supportedSdkPairs = dependencies.supportedSdkPairs.map((pair) => ({
    appSdkVersion: pair.appSdkVersion,
    workerMessagingSdkVersion: pair.workerMessagingSdkVersion,
  }));
  const successfulArtifacts: Array<{
    configSourceId: string;
    projectId: string;
  }> = [];

  return {
    build(input) {
      const workerConfig = input.workerConfigOverride ?? input.publicConfig;
      if (!firebasePublicConfigsMatch(input.publicConfig, workerConfig)) {
        return { kind: "BuildFailed", code: "FIREBASE_CONFIG_DRIFT" };
      }

      if (!isSupportedFirebaseSdkPair(input, supportedSdkPairs)) {
        return { kind: "BuildFailed", code: "FIREBASE_SDK_INCOMPATIBLE" };
      }

      const emittedFiles = copyFiles(
        dependencies.artifactEmitter.emitIntegratedWorker({
          configSourceId: input.configSourceId,
          appSdkVersion: input.appSdkVersion,
          workerMessagingSdkVersion: input.workerMessagingSdkVersion,
        }),
      );
      if (
        !isSafeIntegratedFirebaseWorkerArtifact(
          emittedFiles,
          input.publicConfig,
        )
      ) {
        return { kind: "BuildFailed", code: "WORKER_ARTIFACT_UNSAFE" };
      }

      const artifact: FirebaseWorkerBuildArtifact = {
        webConfig: copyConfig(input.publicConfig),
        workerConfig: copyConfig(workerConfig),
        configSourceId: input.configSourceId,
        appSdkVersion: input.appSdkVersion,
        workerMessagingSdkVersion: input.workerMessagingSdkVersion,
        emittedFiles,
      };
      successfulArtifacts.push({
        configSourceId: artifact.configSourceId,
        projectId: artifact.webConfig.projectId,
      });

      return { kind: "Built", artifact };
    },

    state() {
      return {
        artifacts: successfulArtifacts.map((artifact) => ({ ...artifact })),
      };
    },
  };
}
