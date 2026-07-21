import type {
  AcceptDuplicateNotificationResult,
  CaptureDuplicateNotificationInputPort,
  CaptureDuplicateObservedEvent,
  DeliverDuplicateNotificationResult,
} from "./ports/in/captureDuplicateNotificationPort";
import type {
  CaptureDuplicateDeliveryRecord,
  CaptureDuplicateIntentStatus,
  CaptureDuplicateNotificationProvider,
  CaptureDuplicateNotificationStore,
  DuplicateDeliveryStatus,
  DuplicateDeliveryTerminalStatus,
} from "./ports/outbound/captureDuplicateNotificationPorts";

const SUPPORTED_PRODUCER = "payment-capture.intake";
const SUPPORTED_SCHEMA_VERSION = 1;

type DeliveryClaim =
  | { kind: "claimed"; delivery: CaptureDuplicateDeliveryRecord }
  | { kind: "in-progress" }
  | { kind: "terminal"; status: DuplicateDeliveryTerminalStatus };

function intentIdFor(eventId: string): string {
  return `capture-duplicate-intent:${eventId}`;
}

function deliveryIdFor(
  eventId: string,
  recipientMemberId: string,
  endpointId: string,
): string {
  return `capture-duplicate-delivery:${eventId}:${recipientMemberId}:${endpointId}`;
}

function isTerminalStatus(
  status: DuplicateDeliveryStatus,
): status is DuplicateDeliveryTerminalStatus {
  return status !== "queued" && status !== "sending";
}

function publicDeliveryResult(
  status: DuplicateDeliveryTerminalStatus,
): DeliverDuplicateNotificationResult {
  switch (status) {
    case "delivered":
      return { kind: "Delivered" };
    case "failed":
      return { kind: "Failed" };
    case "unknown-provider-outcome":
      return { kind: "UnknownProviderOutcome" };
    case "permanent-failure":
      return { kind: "PermanentFailure" };
  }
}

function aggregateIntentStatus(
  deliveries: readonly CaptureDuplicateDeliveryRecord[],
): CaptureDuplicateIntentStatus {
  if (
    deliveries.some(
      (delivery) =>
        delivery.status === "queued" || delivery.status === "sending",
    )
  ) {
    return "queued";
  }

  return deliveries.every((delivery) => delivery.status === "delivered")
    ? "delivered"
    : "failed";
}

class DefaultCaptureDuplicateNotificationConsumer
  implements CaptureDuplicateNotificationInputPort
{
  constructor(
    private readonly store: CaptureDuplicateNotificationStore,
    private readonly provider: CaptureDuplicateNotificationProvider,
  ) {}

  async accept(
    event: CaptureDuplicateObservedEvent,
  ): Promise<AcceptDuplicateNotificationResult> {
    if (event.producer !== SUPPORTED_PRODUCER) {
      return { kind: "ContractFailure", code: "UNKNOWN_PRODUCER" };
    }
    if (event.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      return {
        kind: "ContractFailure",
        code: "UNSUPPORTED_EVENT_VERSION",
      };
    }

    return this.store.runAcceptance(event, async (transaction) => {
      const existing = await transaction.readInbox();
      if (existing !== null) {
        return {
          kind: "AlreadyProcessed",
          intentId: existing.intentId,
          deliveryIds: existing.deliveryIds,
        };
      }

      const intentId = intentIdFor(event.eventId);
      const endpoints = (await transaction.listEndpoints())
        .filter(
          (endpoint) =>
            endpoint.householdId === event.householdId &&
            endpoint.memberId === event.recipientMemberId &&
            endpoint.platform === "ios-pwa" &&
            endpoint.status === "active",
        )
        .slice()
        .sort((left, right) => left.endpointId.localeCompare(right.endpointId));
      const deliveries: CaptureDuplicateDeliveryRecord[] = endpoints.map(
        (endpoint) => ({
          deliveryId: deliveryIdFor(
            event.eventId,
            event.recipientMemberId,
            endpoint.endpointId,
          ),
          intentId,
          eventId: event.eventId,
          endpointId: endpoint.endpointId,
          fid: endpoint.fid,
          status: "queued",
        }),
      );
      const deliveryIds = deliveries.map((delivery) => delivery.deliveryId);

      await transaction.saveIntent({
        intentId,
        eventId: event.eventId,
        transactionId: event.existingTransactionId,
        recipientMemberId: event.recipientMemberId,
        status: deliveries.length === 0 ? "no-target" : "queued",
      });
      await transaction.saveDeliveries(deliveries);
      await transaction.saveInbox({
        eventId: event.eventId,
        intentId,
        deliveryIds,
      });

      return deliveries.length === 0
        ? { kind: "NoTarget", intentId }
        : { kind: "Queued", intentId, deliveryIds };
    });
  }

  async deliver(
    deliveryId: string,
  ): Promise<DeliverDuplicateNotificationResult> {
    const claim = await this.store.runForDelivery<DeliveryClaim>(
      deliveryId,
      async (transaction) => {
        const delivery = await transaction.readDelivery();
        if (delivery === null) {
          throw new Error(`Unknown capture duplicate delivery: ${deliveryId}`);
        }
        if (isTerminalStatus(delivery.status)) {
          return { kind: "terminal", status: delivery.status };
        }
        if (delivery.status === "sending") {
          return { kind: "in-progress" };
        }

        const claimed: CaptureDuplicateDeliveryRecord = {
          ...delivery,
          status: "sending",
        };
        await transaction.saveDelivery(claimed);
        return { kind: "claimed", delivery: claimed };
      },
    );

    if (claim.kind === "terminal") {
      return publicDeliveryResult(claim.status);
    }
    if (claim.kind === "in-progress") {
      return publicDeliveryResult(
        await this.store.waitForTerminalDelivery(deliveryId),
      );
    }

    const outcome = await this.provider.sendOne({
      deliveryId: claim.delivery.deliveryId,
      endpointId: claim.delivery.endpointId,
      fid: claim.delivery.fid,
    });

    await this.store.runForDelivery(deliveryId, async (transaction) => {
      const current = await transaction.readDelivery();
      if (current === null) {
        throw new Error(`Unknown capture duplicate delivery: ${deliveryId}`);
      }

      await transaction.saveDelivery({ ...current, status: outcome });
      const intent = await transaction.readIntent(current.intentId);
      if (intent === null) {
        throw new Error(`Unknown capture duplicate intent: ${current.intentId}`);
      }
      const relatedDeliveries = await transaction.listIntentDeliveries(
        current.intentId,
      );
      const completedDeliveries = relatedDeliveries.map((delivery) =>
        delivery.deliveryId === deliveryId
          ? { ...delivery, status: outcome }
          : delivery,
      );
      await transaction.saveIntent({
        ...intent,
        status: aggregateIntentStatus(completedDeliveries),
      });
    });

    return publicDeliveryResult(outcome);
  }
}

export function createCaptureDuplicateNotificationConsumer(
  store: CaptureDuplicateNotificationStore,
  provider: CaptureDuplicateNotificationProvider,
): CaptureDuplicateNotificationInputPort {
  return new DefaultCaptureDuplicateNotificationConsumer(store, provider);
}
