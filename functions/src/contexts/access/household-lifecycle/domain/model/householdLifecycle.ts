export interface HouseholdLifecycleView {
  householdId: string;
  lifecycleState: "active" | "deleted" | "purging" | "purged";
  aggregateVersion: number;
  deletedAt?: string;
}

export interface HouseholdLifecycleRecord extends HouseholdLifecycleView {
  deletedByHash?: string;
}

export interface HouseholdLifecycleEvent {
  eventType: "HouseholdRestored.v1";
  householdId: string;
  restoredAt: string;
  restoredByHash: string;
}

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
  receipts: readonly HouseholdLifecycleReceipt[];
  events: readonly HouseholdLifecycleEvent[];
}
