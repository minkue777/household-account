import type {
  AndroidBackupArtifactResult,
  AndroidBackupPolicyInputPort,
  AndroidBackupPolicyState,
  AndroidFreshInstallationRestoreResult,
  AndroidLocalDataKey,
  AndroidLocalDataSnapshot,
  AndroidRestoreMode,
} from "./ports/in/androidBackupPolicyInputPort";

const RESTORABLE_NON_SENSITIVE_KEYS = ["quickEditPreference"] as const satisfies
  readonly AndroidLocalDataKey[];

function copySnapshot(
  snapshot: AndroidLocalDataSnapshot,
): AndroidLocalDataSnapshot {
  return { ...snapshot };
}

class DefaultAndroidBackupPolicyApplication
  implements AndroidBackupPolicyInputPort
{
  private installation: AndroidLocalDataSnapshot;
  private readonly explicitlyAllowedKeys: ReadonlySet<AndroidLocalDataKey>;

  constructor(
    localData: AndroidLocalDataSnapshot,
    explicitlyAllowedNonSensitiveKeys: readonly AndroidLocalDataKey[],
  ) {
    this.installation = copySnapshot(localData);
    this.explicitlyAllowedKeys = new Set(explicitlyAllowedNonSensitiveKeys);
  }

  createArtifact(mode: AndroidRestoreMode): AndroidBackupArtifactResult {
    return {
      kind: "ArtifactCreated",
      mode,
      includedKeys: this.restorableKeys(),
    };
  }

  restoreOnFreshInstallation(
    mode: AndroidRestoreMode,
  ): AndroidFreshInstallationRestoreResult {
    void mode;
    const restored = Object.fromEntries(
      this.restorableKeys().map((key) => [key, this.installation[key]]),
    ) as AndroidLocalDataSnapshot;
    this.installation = restored;
    return {
      kind: "FreshUnauthenticatedInstallation",
      restored: copySnapshot(restored),
      keystoreKeyRestored: false,
    };
  }

  state(): AndroidBackupPolicyState {
    return {
      installation: copySnapshot(this.installation),
      authenticatedActorPresent:
        this.installation.firebaseAuthState !== undefined ||
        this.installation.sessionMirror !== undefined,
      pendingCaptureQueueEntries:
        this.installation.captureQueueCiphertext === undefined ? 0 : 1,
    };
  }

  private restorableKeys(): readonly AndroidLocalDataKey[] {
    return RESTORABLE_NON_SENSITIVE_KEYS.filter(
      (key) =>
        this.explicitlyAllowedKeys.has(key) &&
        this.installation[key] !== undefined,
    );
  }
}

export function createAndroidBackupPolicyApplication(input: {
  readonly localData: AndroidLocalDataSnapshot;
  readonly explicitlyAllowedNonSensitiveKeys: readonly AndroidLocalDataKey[];
}): AndroidBackupPolicyInputPort {
  return new DefaultAndroidBackupPolicyApplication(
    input.localData,
    input.explicitlyAllowedNonSensitiveKeys,
  );
}
