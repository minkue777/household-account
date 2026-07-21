import type {
  FirebasePublicBuildConfig,
  FirebaseSdkCompatibilityPair,
  FirebaseWorkerEmittedFile,
} from "../model/firebaseWorkerBuild";

const firebaseConfigFields = [
  "projectId",
  "appId",
  "messagingSenderId",
  "apiKey",
] as const satisfies readonly (keyof FirebasePublicBuildConfig)[];

const forbiddenWorkerSourcePatterns = [
  /firebase-(?:app|messaging)-compat/i,
  /firebase(?:js)?\/compat(?:\/|["'])/i,
  /\bfirebase\s*\.\s*(?:initializeApp|messaging)\b/i,
  /\bgetToken\s*\(/i,
  /firebase-messaging-sw\.js/i,
] as const;

export function firebasePublicConfigsMatch(
  webConfig: FirebasePublicBuildConfig,
  workerConfig: FirebasePublicBuildConfig,
): boolean {
  return firebaseConfigFields.every(
    (field) => webConfig[field] === workerConfig[field],
  );
}

export function isSupportedFirebaseSdkPair(
  candidate: FirebaseSdkCompatibilityPair,
  supportedPairs: readonly FirebaseSdkCompatibilityPair[],
): boolean {
  return supportedPairs.some(
    (supported) =>
      supported.appSdkVersion === candidate.appSdkVersion &&
      supported.workerMessagingSdkVersion ===
        candidate.workerMessagingSdkVersion,
  );
}

export function isSafeIntegratedFirebaseWorkerArtifact(
  emittedFiles: readonly FirebaseWorkerEmittedFile[],
  publicConfig: FirebasePublicBuildConfig,
): boolean {
  if (emittedFiles.length !== 1 || emittedFiles[0]?.path !== "/sw.js") {
    return false;
  }

  const workerSource = emittedFiles[0].contents;
  if (workerSource.trim().length === 0) return false;

  if (
    forbiddenWorkerSourcePatterns.some((pattern) => pattern.test(workerSource))
  ) {
    return false;
  }

  return firebaseConfigFields.every((field) => {
    const hardcodedValue = publicConfig[field];
    return hardcodedValue.length === 0 || !workerSource.includes(hardcodedValue);
  });
}
