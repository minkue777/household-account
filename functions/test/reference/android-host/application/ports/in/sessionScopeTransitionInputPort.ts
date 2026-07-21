export interface SessionScopeSnapshot {
  readonly schemaVersion: 1;
  readonly sessionGeneration: string;
  readonly householdId: string;
  readonly memberId: string;
}

export interface ActorBoundStateSnapshot {
  readonly session?: SessionScopeSnapshot;
  readonly quickEditTransactionIds: readonly string[];
  readonly captureObservationIds: readonly string[];
}

export interface SessionMirrorStorageEvidence {
  readonly encryption: "android-keystore-backed";
  readonly snapshotWrite: "atomic";
  readonly keyExportable: false;
  readonly backupEligible: false;
  readonly persistedIdentityFields: readonly [
    "schemaVersion",
    "sessionGeneration",
    "householdId",
    "memberId",
  ];
}

export type SessionTransitionOutcome =
  | { readonly kind: "Applied"; readonly session: SessionScopeSnapshot }
  | { readonly kind: "Cleared" }
  | {
      readonly kind: "Rejected";
      readonly code: "SESSION_TRANSITION_BLOCKED";
      readonly retainedSession: SessionScopeSnapshot;
    };

export type InterruptedSessionTransitionRecoveryOutcome =
  | { readonly kind: "NoRecoveryNeeded" }
  | {
      readonly kind: "RecoveredFailClosed";
      readonly discardedTargetGeneration: string;
    };

export type LegacyQuickEditPreferenceMigrationOutcome =
  | { readonly kind: "Migrated"; readonly value: boolean }
  | { readonly kind: "AlreadyStable"; readonly value: boolean }
  | { readonly kind: "NoLegacyValue" };

export interface SessionScopeTransitionInputPort {
  transitionTo(
    next: SessionScopeSnapshot,
    queuePurgeResult: "success" | "failure",
  ): Promise<SessionTransitionOutcome>;
  logout(
    queuePurgeResult: "success" | "failure",
  ): Promise<SessionTransitionOutcome>;
  recoverInterruptedTransition(): Promise<InterruptedSessionTransitionRecoveryOutcome>;
  migrateLegacyQuickEditPreference(input: {
    readonly householdId: string;
    readonly memberId: string;
    readonly legacyDisplayName: string;
  }): LegacyQuickEditPreferenceMigrationOutcome;
  quickEditPreferenceFor(input: {
    readonly householdId: string;
    readonly memberId: string;
    readonly currentDisplayName: string;
  }): boolean | undefined;
  storageEvidence(): SessionMirrorStorageEvidence;
  state(): ActorBoundStateSnapshot;
}
