export interface NotificationPurgeSystemActor {
  systemRef: string;
  capabilities: readonly "householdLifecycle:purge"[];
}

export type NotificationPurgePageResult =
  | {
      kind: "PageProcessed";
      processId: string;
      checkpoint: string;
      nextCheckpoint: string;
      deletedCount: number;
    }
  | {
      kind: "PurgeCompleted";
      processId: string;
      checkpoint: string;
      deletedCount: number;
    }
  | { kind: "Forbidden"; code: "PURGE_SYSTEM_CAPABILITY_REQUIRED" };

export type LifecycleSignalResult =
  | { kind: "Ignored"; reason: "LOGICAL_DELETE_DOES_NOT_PURGE" }
  | { kind: "AcceptedForPurge"; processId: string };

export interface NotificationHouseholdPurgeInputPort {
  handleHouseholdLifecycleSignal(input: {
    eventType: "HouseholdDeleted.v1" | "HouseholdPermanentPurgeRequested.v1";
    householdId: string;
    processId?: string;
  }): Promise<LifecycleSignalResult>;
  purgeHouseholdData(
    actor: NotificationPurgeSystemActor,
    input: {
      householdId: string;
      processId: string;
      checkpoint: string;
    },
  ): Promise<NotificationPurgePageResult>;
}
