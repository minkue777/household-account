import type {
  DeliveryReconciliationInputPort,
  ReconcileDeliveryResult,
} from "./ports/in/deliveryReconciliationPort";
import type { DeliveryReconciliationStore } from "./ports/outbound/deliveryReconciliationPorts";
import { terminalRetention } from "../domain/policies/notificationRetentionPolicy";

class DefaultDeliveryReconciliationApplication
  implements DeliveryReconciliationInputPort
{
  constructor(private readonly store: DeliveryReconciliationStore) {}

  async reconcileStuckDelivery(
    deliveryId: string,
    now: string,
  ): Promise<ReconcileDeliveryResult> {
    return this.store.runForDelivery(deliveryId, async (transaction) => {
      const delivery = await transaction.readDelivery();
      if (delivery === null) {
        throw new Error(`Notification delivery not found: ${deliveryId}`);
      }
      if (delivery.status === "unknown-provider-outcome") {
        return {
          kind: "AlreadyTerminal",
          status: "unknown-provider-outcome",
        };
      }

      await transaction.saveDelivery({
        ...delivery,
        status: "unknown-provider-outcome",
        providerOutcomeCommitted: true,
        errorCode: "WORKER_INTERRUPTED_AFTER_PROVIDER_CALL",
        ...terminalRetention(now),
      });
      await transaction.appendTerminalEventOnce({
        eventId: `notification-delivery-terminal:${delivery.deliveryId}`,
        deliveryId: delivery.deliveryId,
        householdId: delivery.householdId,
        status: "unknown-provider-outcome",
        occurredAt: now,
      });
      return {
        kind: "UnknownProviderOutcome",
        code: "WORKER_INTERRUPTED_AFTER_PROVIDER_CALL",
      };
    });
  }
}

export function createDeliveryReconciliationApplication(
  store: DeliveryReconciliationStore,
): DeliveryReconciliationInputPort {
  return new DefaultDeliveryReconciliationApplication(store);
}
