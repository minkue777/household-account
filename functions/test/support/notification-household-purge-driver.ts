import { createNotificationHouseholdPurgeApplication } from "../../src/contexts/notifications/application/notificationHouseholdPurgeApplication";
import type {
  NotificationHouseholdPurgeStore,
  NotificationOwnedRecord,
  NotificationPurgePageReceipt,
  NotificationPurgePageTransaction,
} from "../../src/contexts/notifications/application/ports/outbound/notificationHouseholdPurgeStore";
import {
  notificationPurgeCheckpointKey,
  notificationPurgeRecordKey,
} from "../../src/contexts/notifications/domain/policies/notificationPurgePolicy";
import type {
  NotificationHouseholdPurgeInputPort,
  NotificationPurgePageResult,
} from "../../src/contexts/notifications/public";

export type { NotificationOwnedRecord };

export interface NotificationPurgeSnapshot {
  records: readonly NotificationOwnedRecord[];
  pageReceipts: readonly {
    processId: string;
    checkpoint: string;
    result: Exclude<NotificationPurgePageResult, { kind: "Forbidden" }>;
  }[];
  providerCalls: readonly {
    deliveryId: string;
    endpointId: string;
  }[];
}

export interface NotificationHouseholdPurgeFixture {
  pageSize: number;
  records: readonly NotificationOwnedRecord[];
  providerCalls?: NotificationPurgeSnapshot["providerCalls"];
}

export interface NotificationHouseholdPurgeFixtureSubject
  extends NotificationHouseholdPurgeInputPort {
  snapshot(): Promise<NotificationPurgeSnapshot>;
}

function cloneRecord(record: NotificationOwnedRecord): NotificationOwnedRecord {
  return { ...record };
}

function cloneReceipt(
  receipt: NotificationPurgePageReceipt,
): NotificationPurgePageReceipt {
  return { ...receipt, result: { ...receipt.result } };
}

function storageKey(record: NotificationOwnedRecord): string {
  return `${record.householdId}\u0000${notificationPurgeRecordKey(record)}`;
}

class FixtureNotificationPurgePageTransaction
  implements NotificationPurgePageTransaction
{
  constructor(
    private readonly input: {
      householdId: string;
      processId: string;
      checkpoint: string;
    },
    private readonly records: Map<string, NotificationOwnedRecord>,
    private readonly receipts: Map<string, NotificationPurgePageReceipt>,
  ) {}

  private receiptKey(): string {
    return `${this.input.householdId}\u0000${this.input.processId}\u0000${this.input.checkpoint}`;
  }

  async readReceipt(): Promise<NotificationPurgePageReceipt | null> {
    const receipt = this.receipts.get(this.receiptKey());
    return receipt === undefined ? null : cloneReceipt(receipt);
  }

  async listRecordsAfter(input: {
    householdId: string;
    checkpoint: string;
    limit: number;
  }): Promise<readonly NotificationOwnedRecord[]> {
    const afterKey = notificationPurgeCheckpointKey(input.checkpoint);
    return [...this.records.values()]
      .filter(
        (record) =>
          record.householdId === input.householdId &&
          (afterKey === null || notificationPurgeRecordKey(record) > afterKey),
      )
      .sort((left, right) =>
        notificationPurgeRecordKey(left).localeCompare(
          notificationPurgeRecordKey(right),
        ),
      )
      .slice(0, input.limit)
      .map(cloneRecord);
  }

  async deleteRecords(
    records: readonly NotificationOwnedRecord[],
  ): Promise<void> {
    for (const record of records) {
      this.records.delete(storageKey(record));
    }
  }

  async saveReceipt(receipt: NotificationPurgePageReceipt): Promise<void> {
    if (
      receipt.householdId !== this.input.householdId ||
      receipt.processId !== this.input.processId ||
      receipt.checkpoint !== this.input.checkpoint
    ) {
      throw new Error("Purge receipt identity mismatch");
    }
    this.receipts.set(this.receiptKey(), cloneReceipt(receipt));
  }
}

class FixtureNotificationHouseholdPurgeStore
  implements NotificationHouseholdPurgeStore
{
  private records: Map<string, NotificationOwnedRecord>;
  private receipts = new Map<string, NotificationPurgePageReceipt>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly configuredPageSize: number,
    records: readonly NotificationOwnedRecord[],
  ) {
    if (!Number.isInteger(configuredPageSize) || configuredPageSize <= 0) {
      throw new Error("Purge page size must be a positive integer");
    }
    this.records = new Map(
      records.map((record) => [storageKey(record), cloneRecord(record)]),
    );
  }

  pageSize(): number {
    return this.configuredPageSize;
  }

  async runPage<T>(
    input: { householdId: string; processId: string; checkpoint: string },
    operation: (transaction: NotificationPurgePageTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.transactionTail = previous.then(() => gate);

    await previous;
    try {
      const workingRecords = new Map(
        [...this.records].map(([key, value]) => [key, cloneRecord(value)]),
      );
      const workingReceipts = new Map(
        [...this.receipts].map(([key, value]) => [key, cloneReceipt(value)]),
      );
      const result = await operation(
        new FixtureNotificationPurgePageTransaction(
          input,
          workingRecords,
          workingReceipts,
        ),
      );
      this.records = workingRecords;
      this.receipts = workingReceipts;
      return result;
    } finally {
      release();
    }
  }

  snapshot(
    providerCalls: NotificationPurgeSnapshot["providerCalls"],
  ): NotificationPurgeSnapshot {
    return {
      records: [...this.records.values()].map(cloneRecord),
      pageReceipts: [...this.receipts.values()].map((receipt) => ({
        processId: receipt.processId,
        checkpoint: receipt.checkpoint,
        result: { ...receipt.result },
      })),
      providerCalls: providerCalls.map((call) => ({ ...call })),
    };
  }
}

export function createNotificationHouseholdPurgeFixtureSubject(
  fixture: NotificationHouseholdPurgeFixture,
): NotificationHouseholdPurgeFixtureSubject {
  const store = new FixtureNotificationHouseholdPurgeStore(
    fixture.pageSize,
    fixture.records,
  );
  const providerCalls = fixture.providerCalls ?? [];
  const input = createNotificationHouseholdPurgeApplication(store);
  return {
    handleHouseholdLifecycleSignal: (signal) =>
      input.handleHouseholdLifecycleSignal(signal),
    purgeHouseholdData: (actor, command) =>
      input.purgeHouseholdData(actor, command),
    snapshot: async () => store.snapshot(providerCalls),
  };
}
