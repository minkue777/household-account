import type { DeliveryAssuranceInputPort } from "./ports/in/deliveryAssurancePort";

export interface NotificationOutboxEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  householdId: string;
  aggregateId?: string;
  payload: Readonly<Record<string, unknown>>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function createNotificationOutboxDispatchApplication(input: {
  delivery: DeliveryAssuranceInputPort;
  memberRemoval: {
    cleanupMemberEndpoints(eventId: string, householdId: string, memberId: string, occurredAt: string): Promise<unknown>;
  };
  legacyShortcut?: { completion(eventId: string, householdId: string, now: string): Promise<"delivered" | "failed" | undefined> };
  clock?: { now(): string };
}) {
  return {
    async consume(event: NotificationOutboxEvent) {
      if (event.eventType === "HouseholdMemberRemoved.v1") {
        const memberId = text(event.payload.memberId) ?? event.aggregateId;
        if (memberId === undefined) throw new Error("MEMBER_REMOVED_EVENT_INVALID");
        await input.memberRemoval.cleanupMemberEndpoints(event.eventId, event.householdId, memberId, event.occurredAt);
        return { kind: "Completed", status: "succeeded" } as const;
      }
      if (!["HouseholdNotificationRequested.v1", "TransactionRecorded.v1", "CaptureDuplicateObserved.v1"].includes(event.eventType)) {
        return { kind: "Ignored" } as const;
      }
      const legacy = await input.legacyShortcut?.completion(event.eventId, event.householdId, input.clock?.now() ?? new Date().toISOString());
      if (legacy !== undefined) return { kind: "Completed", status: legacy === "delivered" ? "succeeded" : "failed" } as const;
      const transactionId = text(event.payload.transactionId) ?? text(event.payload.existingTransactionId) ?? event.aggregateId;
      if (transactionId === undefined) throw new Error("NOTIFICATION_TRANSACTION_REQUIRED");
      const common = { eventId: event.eventId, occurredAt: event.occurredAt, householdId: event.householdId, transactionId };
      const accepted = event.eventType === "HouseholdNotificationRequested.v1"
        ? await input.delivery.accept({
            ...common, eventType: "HouseholdNotificationRequested.v1", producer: "household-finance.ledger",
            requesterMemberId: text(event.payload.requesterMemberId) ?? "",
          })
        : await input.delivery.accept({
            ...common,
            eventType: event.eventType as "TransactionRecorded.v1" | "CaptureDuplicateObserved.v1",
            producer: "payment-capture.shortcut-ingestion",
            creatorMemberId: text(event.payload.creatorMemberId),
            originChannel: text(event.payload.originChannel) ?? "",
          });
      if (accepted.kind === "RetryableFailure") throw new Error(accepted.code);
      if (accepted.kind === "Queued" || accepted.kind === "AlreadyProcessed") {
        const results = await Promise.all(accepted.deliveryIds.map((id) => input.delivery.deliver(id)));
        await input.delivery.completeIntent(accepted.intentId);
        return {
          kind: "Completed", intentId: accepted.intentId,
          status: results.length > 0 && results.every((result) => result.kind === "Delivered") ? "succeeded" : "failed",
        } as const;
      }
      return {
        kind: accepted.kind,
        ...(accepted.kind === "ContractFailure" ? { code: accepted.code } : {}),
        status: accepted.kind === "ContractFailure" ? "failed" : "rejected",
      } as const;
    },
  };
}
