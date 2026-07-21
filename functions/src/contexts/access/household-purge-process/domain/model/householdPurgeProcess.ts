export const HOUSEHOLD_PURGE_PARTICIPANTS = [
  "household-finance",
  "payment-capture",
  "portfolio",
  "notifications",
  "access-household",
] as const;

export type HouseholdPurgeParticipant =
  (typeof HOUSEHOLD_PURGE_PARTICIPANTS)[number];

export interface HouseholdPurgeClaim {
  readonly claimRef: string;
  readonly principalRef: string;
  readonly householdId: string;
  readonly membershipId: string;
  readonly version: number;
}

export interface HouseholdPurgeClaimSnapshotEntry {
  readonly claimRef: string;
  readonly membershipId: string;
  readonly version: number;
}

export interface HouseholdPurgeClaimConflict {
  readonly claimRef: string;
  readonly reason: "CURRENT_CLAIM_CHANGED";
}

export interface HouseholdPurgeParticipantProgress {
  readonly status: "pending" | "completed";
  readonly checkpoint: string;
  readonly lastFailureCode?: string;
}

export type HouseholdPurgePhase =
  | "claim-snapshot"
  | "context-purge"
  | "claim-finalization"
  | "completed";

export interface HouseholdPurgeProcessRecord {
  readonly processId: string;
  readonly householdId: string;
  readonly confirmationRefHash: string;
  readonly phase: HouseholdPurgePhase;
  readonly claimPageSize: number;
  readonly claimSnapshotCheckpoint: string;
  readonly claimSnapshotEntries: readonly HouseholdPurgeClaimSnapshotEntry[];
  readonly participants: Readonly<
    Record<HouseholdPurgeParticipant, HouseholdPurgeParticipantProgress>
  >;
  readonly claimFinalizationCheckpoint: string;
  readonly releasedClaimCount: number;
  readonly absentClaimCount: number;
  readonly claimConflicts: readonly HouseholdPurgeClaimConflict[];
}

export interface HouseholdPurgeRequestReceipt {
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly processId: string;
}

export type HouseholdPurgeProcessEvent =
  | {
      readonly eventType: "HouseholdPermanentPurgeRequested.v1";
      readonly householdId: string;
      readonly processId: string;
      readonly confirmationRefHash: string;
    }
  | {
      readonly eventType: "HouseholdPurged.v1";
      readonly householdIdHash: string;
      readonly processId: string;
      readonly purgedAt: string;
      readonly releasedClaimCount: number;
    };

export interface HouseholdPurgeAggregateState {
  readonly household: {
    readonly householdId: string;
    readonly lifecycleState: "active" | "deleted" | "purging" | "purged";
    readonly aggregateVersion: number;
  };
  readonly currentClaims: readonly HouseholdPurgeClaim[];
  readonly processes: Readonly<Record<string, HouseholdPurgeProcessRecord>>;
  readonly requestReceipts: Readonly<
    Record<string, HouseholdPurgeRequestReceipt>
  >;
  readonly events: readonly HouseholdPurgeProcessEvent[];
}

export function initialHouseholdPurgeParticipants(): Readonly<
  Record<HouseholdPurgeParticipant, HouseholdPurgeParticipantProgress>
> {
  return {
    "household-finance": {
      status: "pending",
      checkpoint: "household-finance:start",
    },
    "payment-capture": {
      status: "pending",
      checkpoint: "payment-capture:start",
    },
    portfolio: { status: "pending", checkpoint: "portfolio:start" },
    notifications: { status: "pending", checkpoint: "notifications:start" },
    "access-household": {
      status: "pending",
      checkpoint: "access-household:start",
    },
  };
}

export function requestPurgePayloadFingerprint(input: {
  readonly householdId: string;
  readonly confirmation: string;
  readonly expectedVersion: number;
}): string {
  return JSON.stringify([
    input.householdId,
    input.confirmation.trim(),
    input.expectedVersion,
  ]);
}
