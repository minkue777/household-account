export interface HouseholdLifecycleView {
  householdId: string;
  lifecycleState: "active" | "deleted" | "purging" | "purged";
  aggregateVersion: number;
  deletedAt?: string;
}

export interface HouseholdLifecycleRecord extends HouseholdLifecycleView {
  deletedByHash?: string;
}

export interface HouseholdPurgeRequestRecord {
  processId: string;
  status: "requested" | "running" | "completed";
  confirmationRefHash: string;
}

export type HouseholdLifecycleEvent =
  | {
      eventType: "HouseholdDeleted.v1";
      householdId: string;
      deletedAt: string;
      deletedByHash: string;
    }
  | {
      eventType: "HouseholdRestored.v1";
      householdId: string;
      restoredAt: string;
      restoredByHash: string;
    }
  | {
      eventType: "HouseholdPermanentPurgeRequested.v1";
      householdId: string;
      processId: string;
      confirmationRefHash: string;
    }
  | {
      eventType: "HouseholdPurged.v1";
      householdIdHash: string;
      processId: string;
      purgedAt: string;
      releasedClaimCount: number;
    };

export type StoredHouseholdLifecycleResult =
  | {
      kind: "success";
      household: HouseholdLifecycleView;
      processId?: string;
    }
  | {
      kind: "already-processed";
      household: HouseholdLifecycleView;
      processId?: string;
    };

export interface HouseholdLifecycleReceipt {
  idempotencyKey: string;
  payloadFingerprint: string;
  result: StoredHouseholdLifecycleResult;
}

export interface HouseholdLifecycleState {
  household: HouseholdLifecycleRecord;
  purgeProcess?: HouseholdPurgeRequestRecord;
  receipts: readonly HouseholdLifecycleReceipt[];
  events: readonly HouseholdLifecycleEvent[];
}
