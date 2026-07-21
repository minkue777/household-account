import type {
  HouseholdPurgeAggregateState,
  HouseholdPurgeParticipant,
} from "../../../domain/model/householdPurgeProcess";

export interface HouseholdPurgeMutation<T> {
  readonly state: HouseholdPurgeAggregateState;
  readonly value: T;
}

export interface HouseholdPurgeUnitOfWorkPort {
  read(): Promise<HouseholdPurgeAggregateState>;
  transact<T>(
    operation: (
      state: HouseholdPurgeAggregateState,
    ) => HouseholdPurgeMutation<T>,
  ): Promise<T>;
}

export interface HouseholdPurgeExecutionPort {
  runExclusive<T>(processId: string, operation: () => Promise<T>): Promise<T>;
}

export type HouseholdPurgeParticipantResult =
  | {
      readonly kind: "page-processed";
      readonly nextCheckpoint: string;
      readonly deletedCount: number;
    }
  | {
      readonly kind: "purge-completed";
      readonly finalCheckpoint: string;
      readonly deletedCount: number;
    }
  | {
      readonly kind: "retryable-failure";
      readonly retryCheckpoint: string;
      readonly errorCode: string;
    }
  | {
      readonly kind: "permanent-failure";
      readonly failedCheckpoint: string;
      readonly errorCode: string;
    };

export interface HouseholdPurgeParticipantPort {
  purgeHouseholdData(input: {
    readonly householdId: string;
    readonly processId: string;
    readonly participant: HouseholdPurgeParticipant;
    readonly checkpoint: string;
  }): Promise<HouseholdPurgeParticipantResult>;
}

export interface HouseholdPurgeFaultPort {
  beforeStep(input: {
    readonly phase:
      | "claim-snapshot"
      | "context-purge"
      | "claim-finalization";
    readonly checkpoint: string;
    readonly participant?: HouseholdPurgeParticipant;
  }):
    | { readonly kind: "proceed" }
    | { readonly kind: "retryable-failure" };
}

export interface HouseholdPurgeIdentityPort {
  processId(idempotencyKey: string): string;
}

export interface HouseholdPurgeHashPort {
  hash(value: string): string;
}

export interface HouseholdPurgeClockPort {
  now(): string;
}
