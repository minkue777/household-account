import type { NotificationPurgePageResult } from "../in/notificationHouseholdPurgePort";

export type NotificationOwnedRecordKind =
  | "endpoint"
  | "intent"
  | "delivery"
  | "inbox";

export interface NotificationOwnedRecord {
  recordId: string;
  householdId: string;
  kind: NotificationOwnedRecordKind;
}

export type StoredNotificationPurgeResult = Exclude<
  NotificationPurgePageResult,
  { kind: "Forbidden" }
>;

export interface NotificationPurgePageReceipt {
  householdId: string;
  processId: string;
  checkpoint: string;
  result: StoredNotificationPurgeResult;
}

export interface NotificationPurgePageTransaction {
  readReceipt(): Promise<NotificationPurgePageReceipt | null>;
  listRecordsAfter(input: {
    householdId: string;
    checkpoint: string;
    limit: number;
  }): Promise<readonly NotificationOwnedRecord[]>;
  deleteRecords(records: readonly NotificationOwnedRecord[]): Promise<void>;
  saveReceipt(receipt: NotificationPurgePageReceipt): Promise<void>;
}

export interface NotificationHouseholdPurgeStore {
  pageSize(): number;
  runPage<T>(
    input: { householdId: string; processId: string; checkpoint: string },
    operation: (transaction: NotificationPurgePageTransaction) => Promise<T>,
  ): Promise<T>;
}
