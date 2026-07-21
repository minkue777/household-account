import type {
  HouseholdPurgeParticipant,
  HouseholdPurgePhase,
} from "../../../domain/model/householdPurgeProcess";

export interface HouseholdPurgeAdministrativeActor {
  readonly principalRef: string;
  readonly capabilities: readonly (
    | "household.purge.permanent"
    | "household.purge.read"
  )[];
}

export interface HouseholdPurgeSystemActor {
  readonly systemRef: string;
  readonly capabilities: readonly "householdLifecycle:purge"[];
}

export type RequestHouseholdPurgeResult =
  | { readonly kind: "accepted"; readonly processId: string }
  | {
      readonly kind: "forbidden";
      readonly code: "PERMANENT_PURGE_CAPABILITY_REQUIRED";
    }
  | {
      readonly kind: "validation-error";
      readonly code: "PURGE_CONFIRMATION_REQUIRED";
    }
  | {
      readonly kind: "conflict";
      readonly code:
        | "HOUSEHOLD_MUST_BE_DELETED"
        | "VERSION_MISMATCH"
        | "IDEMPOTENCY_PAYLOAD_MISMATCH";
      readonly currentVersion?: number;
    };

export type RunHouseholdPurgeProcessResult =
  | {
      readonly kind: "progressed";
      readonly processId: string;
      readonly phase: Exclude<HouseholdPurgePhase, "completed">;
      readonly checkpoint: string;
    }
  | {
      readonly kind: "retryable-failure";
      readonly processId: string;
      readonly phase: Exclude<HouseholdPurgePhase, "completed">;
      readonly checkpoint: string;
      readonly participant?: HouseholdPurgeParticipant;
      readonly code:
        | "CLAIM_READ_UNAVAILABLE"
        | "PARTICIPANT_UNAVAILABLE"
        | "CLAIM_FINALIZATION_UNAVAILABLE";
    }
  | {
      readonly kind: "operational-conflict";
      readonly processId: string;
      readonly phase: "context-purge";
      readonly checkpoint: string;
      readonly participant: HouseholdPurgeParticipant;
      readonly code: "PARTICIPANT_PERMANENT_FAILURE";
    }
  | { readonly kind: "completed"; readonly processId: string }
  | { readonly kind: "already-completed"; readonly processId: string }
  | {
      readonly kind: "forbidden";
      readonly code: "PURGE_SYSTEM_CAPABILITY_REQUIRED";
    }
  | { readonly kind: "not-found"; readonly code: "PURGE_PROCESS_NOT_FOUND" };

export type HouseholdPurgeStatusResult =
  | {
      readonly kind: "Success";
      readonly value: {
        readonly processId: string;
        readonly householdState: "purging" | "purged";
        readonly phase: HouseholdPurgePhase;
        readonly completedParticipants: readonly HouseholdPurgeParticipant[];
        readonly releasedClaimCount: number;
        readonly absentClaimCount: number;
        readonly claimConflictCount: number;
      };
    }
  | {
      readonly kind: "Forbidden";
      readonly code: "PURGE_READ_CAPABILITY_REQUIRED";
    }
  | { readonly kind: "NotFound" };

export interface HouseholdPurgeProcessInputPort {
  requestPermanentHouseholdPurge(
    actor: HouseholdPurgeAdministrativeActor,
    input: {
      readonly householdId: string;
      readonly confirmation: string;
      readonly expectedVersion: number;
      readonly idempotencyKey: string;
    },
  ): Promise<RequestHouseholdPurgeResult>;
  runHouseholdPurgeProcess(
    actor: HouseholdPurgeSystemActor,
    processId: string,
  ): Promise<RunHouseholdPurgeProcessResult>;
  getHouseholdPurgeStatus(
    actor: HouseholdPurgeAdministrativeActor,
    processId: string,
  ): Promise<HouseholdPurgeStatusResult>;
}

export type {
  HouseholdPurgeParticipant,
  HouseholdPurgePhase,
  HouseholdPurgeProcessEvent,
} from "../../../domain/model/householdPurgeProcess";
