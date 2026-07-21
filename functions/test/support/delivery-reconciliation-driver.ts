import { createDeliveryReconciliationApplication } from "../../src/contexts/notifications/application/deliveryReconciliationApplication";
import type {
  DeliveryReconciliationStore,
  DeliveryReconciliationTransaction,
  ReconciliableDeliveryRecord,
} from "../../src/contexts/notifications/application/ports/outbound/deliveryReconciliationPorts";
import type { DeliveryReconciliationInputPort } from "../../src/contexts/notifications/public";

export interface DeliveryReconciliationSeed {
  deliveryId: string;
  householdId: string;
  endpointId: string;
  status: "sending";
  providerAttemptCount: 1;
  providerAttemptStartedAt: string;
  providerOutcomeCommitted: false;
}

export interface DeliveryReconciliationSnapshot {
  delivery: {
    deliveryId: string;
    status: "unknown-provider-outcome";
    providerAttemptCount: 1;
    terminalAt: string;
    expiresAt: string;
  };
  terminalEventCount: number;
}

export interface DeliveryReconciliationFixtureSubject
  extends DeliveryReconciliationInputPort {
  providerSendCalls(): readonly {
    deliveryId: string;
    endpointId: string;
  }[];
  snapshot(): Promise<DeliveryReconciliationSnapshot>;
}

function cloneDelivery(
  delivery: ReconciliableDeliveryRecord,
): ReconciliableDeliveryRecord {
  return { ...delivery };
}

class FixtureReconciliationTransaction
  implements DeliveryReconciliationTransaction
{
  constructor(
    private readonly deliveryId: string,
    private readonly deliveries: Map<string, ReconciliableDeliveryRecord>,
    private readonly terminalEventIds: Set<string>,
  ) {}

  async readDelivery(): Promise<ReconciliableDeliveryRecord | null> {
    const delivery = this.deliveries.get(this.deliveryId);
    return delivery === undefined ? null : cloneDelivery(delivery);
  }

  async saveDelivery(record: ReconciliableDeliveryRecord): Promise<void> {
    if (record.deliveryId !== this.deliveryId) {
      throw new Error("Delivery identity mismatch");
    }
    this.deliveries.set(record.deliveryId, cloneDelivery(record));
  }

  async appendTerminalEventOnce(input: {
    eventId: string;
    deliveryId: string;
    householdId: string;
    status: "unknown-provider-outcome";
    occurredAt: string;
  }): Promise<void> {
    if (input.deliveryId !== this.deliveryId) {
      throw new Error("Terminal event delivery identity mismatch");
    }
    this.terminalEventIds.add(input.eventId);
  }
}

class FixtureDeliveryReconciliationStore
  implements DeliveryReconciliationStore
{
  private deliveries: Map<string, ReconciliableDeliveryRecord>;
  private terminalEventIds = new Set<string>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(seed: DeliveryReconciliationSeed) {
    this.deliveries = new Map([[seed.deliveryId, { ...seed }]]);
  }

  async runForDelivery<T>(
    deliveryId: string,
    operation: (transaction: DeliveryReconciliationTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.transactionTail = previous.then(() => gate);

    await previous;
    try {
      const workingDeliveries = new Map(
        [...this.deliveries].map(([key, value]) => [
          key,
          cloneDelivery(value),
        ]),
      );
      const workingTerminalEventIds = new Set(this.terminalEventIds);
      const result = await operation(
        new FixtureReconciliationTransaction(
          deliveryId,
          workingDeliveries,
          workingTerminalEventIds,
        ),
      );
      this.deliveries = workingDeliveries;
      this.terminalEventIds = workingTerminalEventIds;
      return result;
    } finally {
      release();
    }
  }

  snapshot(): DeliveryReconciliationSnapshot {
    const delivery = [...this.deliveries.values()][0];
    if (
      delivery === undefined ||
      delivery.status !== "unknown-provider-outcome" ||
      delivery.terminalAt === undefined ||
      delivery.expiresAt === undefined
    ) {
      throw new Error("Reconciled terminal delivery is unavailable");
    }
    return {
      delivery: {
        deliveryId: delivery.deliveryId,
        status: delivery.status,
        providerAttemptCount: delivery.providerAttemptCount,
        terminalAt: delivery.terminalAt,
        expiresAt: delivery.expiresAt,
      },
      terminalEventCount: this.terminalEventIds.size,
    };
  }
}

export function createDeliveryReconciliationFixtureSubject(
  seed: DeliveryReconciliationSeed,
): DeliveryReconciliationFixtureSubject {
  const store = new FixtureDeliveryReconciliationStore(seed);
  const input = createDeliveryReconciliationApplication(store);
  return {
    reconcileStuckDelivery: (deliveryId, now) =>
      input.reconcileStuckDelivery(deliveryId, now),
    providerSendCalls: () => [],
    snapshot: async () => store.snapshot(),
  };
}
