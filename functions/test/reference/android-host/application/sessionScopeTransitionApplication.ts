import type {
  ActorBoundStateSnapshot,
  SessionScopeSnapshot,
  SessionScopeTransitionInputPort,
} from "./ports/in/sessionScopeTransitionInputPort";

export interface SessionScopeTransitionApplicationOptions {
  readonly current: SessionScopeSnapshot;
  readonly quickEditTransactionIds?: readonly string[];
  readonly captureObservationIds?: readonly string[];
  readonly quickEditPreferences?: Readonly<Record<string, boolean>>;
  readonly legacyQuickEditPreferences?: Readonly<Record<string, boolean>>;
  readonly interruptedTransition?: {
    readonly phase: "queues-purged-before-mirror-commit";
    readonly target: SessionScopeSnapshot;
  };
}

const stablePreferenceKey = (householdId: string, memberId: string): string =>
  `${householdId}/${memberId}`;

const cloneSession = (
  session: SessionScopeSnapshot,
): SessionScopeSnapshot => ({ ...session });

export function createSessionScopeTransitionApplication(
  options: SessionScopeTransitionApplicationOptions,
): SessionScopeTransitionInputPort {
  let session: SessionScopeSnapshot | undefined = cloneSession(options.current);
  let quickEditTransactionIds = [...(options.quickEditTransactionIds ?? [])];
  let captureObservationIds = [...(options.captureObservationIds ?? [])];
  const quickEditPreferences: Record<string, boolean> = {
    ...(options.quickEditPreferences ?? {}),
  };
  const legacyQuickEditPreferences: Record<string, boolean> = {
    ...(options.legacyQuickEditPreferences ?? {}),
  };
  let interruptedTransition = options.interruptedTransition;

  const retained = (): SessionScopeSnapshot => {
    if (session === undefined) {
      throw new Error("활성 session이 없는 상태에서는 전환 거부 결과를 만들 수 없습니다.");
    }
    return cloneSession(session);
  };

  return {
    async transitionTo(next, queuePurgeResult) {
      if (queuePurgeResult === "failure") {
        return {
          kind: "Rejected",
          code: "SESSION_TRANSITION_BLOCKED",
          retainedSession: retained(),
        };
      }

      quickEditTransactionIds = [];
      captureObservationIds = [];
      session = cloneSession(next);
      return { kind: "Applied", session: cloneSession(next) };
    },

    async logout(queuePurgeResult) {
      if (queuePurgeResult === "failure") {
        return {
          kind: "Rejected",
          code: "SESSION_TRANSITION_BLOCKED",
          retainedSession: retained(),
        };
      }

      quickEditTransactionIds = [];
      captureObservationIds = [];
      session = undefined;
      return { kind: "Cleared" };
    },

    async recoverInterruptedTransition() {
      if (interruptedTransition === undefined) {
        return { kind: "NoRecoveryNeeded" };
      }

      const discardedTargetGeneration =
        interruptedTransition.target.sessionGeneration;
      interruptedTransition = undefined;
      session = undefined;
      quickEditTransactionIds = [];
      captureObservationIds = [];
      return { kind: "RecoveredFailClosed", discardedTargetGeneration };
    },

    migrateLegacyQuickEditPreference({
      householdId,
      memberId,
      legacyDisplayName,
    }) {
      const stableKey = stablePreferenceKey(householdId, memberId);
      if (Object.prototype.hasOwnProperty.call(quickEditPreferences, stableKey)) {
        return {
          kind: "AlreadyStable",
          value: quickEditPreferences[stableKey],
        };
      }
      if (
        !Object.prototype.hasOwnProperty.call(
          legacyQuickEditPreferences,
          legacyDisplayName,
        )
      ) {
        return { kind: "NoLegacyValue" };
      }

      const value = legacyQuickEditPreferences[legacyDisplayName];
      quickEditPreferences[stableKey] = value;
      delete legacyQuickEditPreferences[legacyDisplayName];
      return { kind: "Migrated", value };
    },

    quickEditPreferenceFor({ householdId, memberId }) {
      return quickEditPreferences[stablePreferenceKey(householdId, memberId)];
    },

    storageEvidence() {
      return {
        encryption: "android-keystore-backed",
        snapshotWrite: "atomic",
        keyExportable: false,
        backupEligible: false,
        persistedIdentityFields: [
          "schemaVersion",
          "sessionGeneration",
          "householdId",
          "memberId",
        ],
      };
    },

    state(): ActorBoundStateSnapshot {
      return {
        session: session === undefined ? undefined : cloneSession(session),
        quickEditTransactionIds: [...quickEditTransactionIds],
        captureObservationIds: [...captureObservationIds],
      };
    },
  };
}
