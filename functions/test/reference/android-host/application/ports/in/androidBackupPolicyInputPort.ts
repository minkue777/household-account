export type AndroidRestoreMode = "cloud-backup" | "device-transfer";

export interface AndroidLocalDataSnapshot {
  readonly firebaseAuthState?: string;
  readonly firebaseInstallationState?: string;
  readonly notificationEndpointBinding?: string;
  readonly sessionMirror?: string;
  readonly legacyHouseholdKey?: string;
  readonly legacyMemberIdentity?: string;
  readonly webViewCookies?: string;
  readonly webViewStorage?: string;
  readonly keystoreKeyMaterial?: string;
  readonly captureQueueCiphertext?: string;
  readonly captureQueueMetadata?: string;
  readonly quickEditQueueCiphertext?: string;
  readonly quickEditQueueMetadata?: string;
  readonly quickEditPreference?: boolean;
}

export type AndroidLocalDataKey = keyof AndroidLocalDataSnapshot;

export interface AndroidBackupArtifactResult {
  readonly kind: "ArtifactCreated";
  readonly mode: AndroidRestoreMode;
  readonly includedKeys: readonly AndroidLocalDataKey[];
}

export interface AndroidFreshInstallationRestoreResult {
  readonly kind: "FreshUnauthenticatedInstallation";
  readonly restored: AndroidLocalDataSnapshot;
  readonly keystoreKeyRestored: false;
}

export interface AndroidBackupPolicyState {
  readonly installation: AndroidLocalDataSnapshot;
  readonly authenticatedActorPresent: boolean;
  readonly pendingCaptureQueueEntries: number;
}

export interface AndroidBackupPolicyInputPort {
  createArtifact(mode: AndroidRestoreMode): AndroidBackupArtifactResult;
  restoreOnFreshInstallation(
    mode: AndroidRestoreMode,
  ): AndroidFreshInstallationRestoreResult;
  state(): AndroidBackupPolicyState;
}
