import { createFirebaseWorkerBuildConfigApplication } from "../reference/pwa/application/firebaseWorkerBuildConfigApplication";
import type { FirebaseWorkerArtifactEmitterPort } from "../reference/pwa/application/ports/out/firebaseWorkerArtifactEmitterPort";
import type {
  FirebaseSdkCompatibilityPair,
  FirebaseWorkerBuildConfigInputPort,
  FirebaseWorkerEmittedFile,
} from "../reference/pwa/public";

export type {
  FirebasePublicBuildConfig,
  FirebaseSdkCompatibilityPair,
  FirebaseWorkerBuildArtifact,
  FirebaseWorkerBuildFailureCode,
  FirebaseWorkerBuildInput,
  FirebaseWorkerBuildResult,
  FirebaseWorkerBuildState,
  FirebaseWorkerEmittedFile,
} from "../reference/pwa/public";

export interface FirebaseWorkerBuildConfigFixture {
  readonly supportedSdkPairs: readonly FirebaseSdkCompatibilityPair[];
  readonly emittedFiles?: readonly FirebaseWorkerEmittedFile[];
}

export interface FirebaseWorkerBuildConfigDriver
  extends FirebaseWorkerBuildConfigInputPort {}

const safeIntegratedWorker: readonly FirebaseWorkerEmittedFile[] = [
  {
    path: "/sw.js",
    contents: [
      'import { initializeApp } from "firebase/app";',
      'import { getMessaging } from "firebase/messaging/sw";',
      'import { firebasePublicConfig } from "./generated/firebase-public-config";',
      "const firebaseApp = initializeApp(firebasePublicConfig);",
      "getMessaging(firebaseApp);",
    ].join("\n"),
  },
];

export function createFirebaseWorkerBuildConfigDriver(
  fixture: FirebaseWorkerBuildConfigFixture,
): FirebaseWorkerBuildConfigDriver {
  const configuredFiles = fixture.emittedFiles ?? safeIntegratedWorker;
  const artifactEmitter: FirebaseWorkerArtifactEmitterPort = {
    emitIntegratedWorker: () =>
      configuredFiles.map(({ path, contents }) => ({ path, contents })),
  };

  return createFirebaseWorkerBuildConfigApplication({
    supportedSdkPairs: fixture.supportedSdkPairs,
    artifactEmitter,
  });
}
