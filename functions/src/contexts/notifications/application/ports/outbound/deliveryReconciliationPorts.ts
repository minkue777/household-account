import type { DeliveryTerminalStatus } from "../../../domain/model/deliveryAssurance";

export interface ReconciliableDeliveryRecord {
  deliveryId: string;
  householdId: string;
  endpointId: string;
  status: "sending" | Extract<DeliveryTerminalStatus, "unknown-provider-outcome">;
  providerAttemptCount: 1;
  providerAttemptStartedAt: string;
  providerOutcomeCommitted: boolean;
  errorCode?: "WORKER_INTERRUPTED_AFTER_PROVIDER_CALL";
  terminalAt?: string;
  expiresAt?: string;
}

export interface DeliveryReconciliationTransaction {
  readDelivery(): Promise<ReconciliableDeliveryRecord | null>;
  saveDelivery(record: ReconciliableDeliveryRecord): Promise<void>;
  appendTerminalEventOnce(input: {
    eventId: string;
    deliveryId: string;
    householdId: string;
    status: "unknown-provider-outcome";
    occurredAt: string;
  }): Promise<void>;
}

export interface DeliveryReconciliationStore {
  runForDelivery<T>(
    deliveryId: string,
    operation: (transaction: DeliveryReconciliationTransaction) => Promise<T>,
  ): Promise<T>;
}
