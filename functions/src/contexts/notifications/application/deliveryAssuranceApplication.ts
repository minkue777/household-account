import type {
  AcceptNotificationIntentResult,
  DeliverNotificationResult,
  DeliveryAssuranceInputPort,
  DeliveryItemView,
  DeliveryStatusView,
  HouseholdNotificationRequestedEvent,
  NotificationInboxStatusView,
  PublicEndpointStatusView,
} from "./ports/in/deliveryAssurancePort";
import type {
  AssuredDeliveryTransaction,
  DeliveryAssuranceClock,
  DeliveryAssuranceProviderPort,
  DeliveryAssuranceStore,
  DeliveryMembershipQueryPort,
  StoredAssuredDelivery,
  StoredDeliveryAssuranceInbox,
} from "./ports/outbound/deliveryAssurancePorts";
import type {
  ClassifiedDeliveryOutcome,
  NotificationProviderOutcome,
} from "../domain/model/deliveryAssurance";
import type { MobileNotificationEndpoint } from "../domain/model/mobileNotificationEndpoint";
import {
  aggregateDeliveryStatuses,
  classifyProviderOutcome,
} from "../domain/policies/deliveryOutcomePolicy";
import { decideEndpointInactivation } from "../domain/policies/endpointInactivationPolicy";
import {
  isNotificationEventExpired,
  terminalRetention,
  terminalRetentionDisposition,
} from "../domain/policies/notificationRetentionPolicy";
import type { NotificationTargetPlanner } from "./planNotificationTargets";

type DeliveryClaim =
  | { kind: "claimed"; delivery: StoredAssuredDelivery; endpoint: MobileNotificationEndpoint }
  | { kind: "in-progress" }
  | { kind: "terminal"; delivery: StoredAssuredDelivery };

function intentIdFor(eventId: string): string {
  return `intent:${encodeURIComponent(eventId)}`;
}

function deliveryIdFor(eventId: string, endpointId: string): string {
  return `delivery:${encodeURIComponent(eventId)}:${encodeURIComponent(endpointId)}`;
}

function isTerminal(
  delivery: StoredAssuredDelivery,
): boolean {
  return delivery.status !== "queued" && delivery.status !== "sending";
}

function toDeliveryResult(
  delivery: StoredAssuredDelivery,
): DeliverNotificationResult {
  switch (delivery.status) {
    case "delivered":
      return { kind: "Delivered" };
    case "failed":
      if (
        delivery.errorCode === "PROVIDER_QUOTA" ||
        delivery.errorCode === "PROVIDER_HTTP_ERROR" ||
        delivery.errorCode === "PROVIDER_NETWORK_ERROR" ||
        delivery.errorCode === "MEMBERSHIP_CHECK_UNAVAILABLE"
      ) {
        return { kind: "Failed", code: delivery.errorCode };
      }
      break;
    case "unknown-provider-outcome":
      if (delivery.errorCode === "PROVIDER_TIMEOUT") {
        return { kind: "UnknownProviderOutcome", code: delivery.errorCode };
      }
      break;
    case "permanent-failure":
      if (delivery.errorCode === "FID_UNREGISTERED") {
        return { kind: "PermanentFailure", code: delivery.errorCode };
      }
      break;
    case "contract-failure":
      if (
        delivery.errorCode === "PROVIDER_CREDENTIAL_INVALID" ||
        delivery.errorCode === "PROVIDER_RESPONSE_INVALID"
      ) {
        return { kind: "ContractFailure", code: delivery.errorCode };
      }
      break;
    case "stale-target":
      if (
        delivery.errorCode === "ENDPOINT_CHANGED" ||
        delivery.errorCode === "RECIPIENT_MEMBERSHIP_INACTIVE"
      ) {
        return { kind: "StaleTarget", code: delivery.errorCode };
      }
      break;
    case "queued":
    case "sending":
      break;
  }
  throw new Error(`Invalid terminal delivery result: ${delivery.deliveryId}`);
}

function replayAcceptedInbox(
  inbox: StoredDeliveryAssuranceInbox,
): AcceptNotificationIntentResult | null {
  if (
    (inbox.status === "accepted" || inbox.status === "terminal") &&
    inbox.intentId !== undefined
  ) {
    return {
      kind: "AlreadyProcessed",
      intentId: inbox.intentId,
      deliveryIds: inbox.deliveryIds ?? [],
    };
  }
  return null;
}

function terminalDelivery(
  delivery: StoredAssuredDelivery,
  outcome: ClassifiedDeliveryOutcome,
  providerAttemptCount: 0 | 1,
  now: string,
): StoredAssuredDelivery {
  return {
    ...delivery,
    status: outcome.status,
    providerAttemptCount,
    ...(outcome.errorCode === undefined
      ? { errorCode: undefined }
      : { errorCode: outcome.errorCode }),
    ...terminalRetention(now),
  };
}

function deliveryView(delivery: StoredAssuredDelivery): DeliveryItemView {
  return {
    deliveryId: delivery.deliveryId,
    recipientMemberId: delivery.recipientMemberId,
    endpointId: delivery.endpointId,
    status: delivery.status === "sending" ? "queued" : delivery.status,
    providerAttemptCount: delivery.providerAttemptCount,
    ...(delivery.errorCode === undefined
      ? {}
      : { errorCode: delivery.errorCode }),
    ...(delivery.terminalAt === undefined
      ? {}
      : { terminalAt: delivery.terminalAt }),
    ...(delivery.expiresAt === undefined
      ? {}
      : { expiresAt: delivery.expiresAt }),
  };
}

class DefaultDeliveryAssuranceApplication implements DeliveryAssuranceInputPort {
  constructor(
    private readonly planner: NotificationTargetPlanner,
    private readonly memberships: DeliveryMembershipQueryPort,
    private readonly store: DeliveryAssuranceStore,
    private readonly provider: DeliveryAssuranceProviderPort,
    private readonly clock: DeliveryAssuranceClock,
  ) {}

  async accept(
    event: HouseholdNotificationRequestedEvent,
  ): Promise<AcceptNotificationIntentResult> {
    const now = this.clock.now();
    if (isNotificationEventExpired(event.occurredAt, now)) {
      await this.store.runAcceptance(event.eventId, async (transaction) => {
        const existing = await transaction.readInbox();
        if (existing === null || existing.status === "retryable") {
          await transaction.saveInbox({
            eventId: event.eventId,
            status: "terminal",
            code: "EXPIRED_EVENT",
            ...terminalRetention(now),
          });
        }
      });
      return { kind: "ExpiredEvent" };
    }

    const existing = await this.store.readInbox(event.eventId);
    if (existing !== null) {
      const replay = replayAcceptedInbox(existing);
      if (replay !== null) {
        return replay;
      }
    }

    const endpoints = await this.store.listEndpoints(event.householdId);
    const memberIds = Array.from(
      new Set([
        event.requesterMemberId,
        ...endpoints
          .filter((endpoint) => endpoint.status === "active")
          .map((endpoint) => endpoint.memberId),
      ]),
    ).sort();
    const membershipEntries = await Promise.all(
      memberIds.map(async (memberId) => [
        memberId,
        await this.memberships.status(event.householdId, memberId),
      ] as const),
    );
    const membershipByMemberId = new Map(membershipEntries);

    if (
      membershipEntries.some(([, status]) => status === "unavailable")
    ) {
      return this.store.runAcceptance(event.eventId, async (transaction) => {
        const concurrent = await transaction.readInbox();
        if (concurrent !== null) {
          const replay = replayAcceptedInbox(concurrent);
          if (replay !== null) {
            return replay;
          }
        }
        await transaction.saveInbox({
          eventId: event.eventId,
          status: "retryable",
          code: "MEMBERSHIP_LOOKUP_UNAVAILABLE",
        });
        return {
          kind: "RetryableFailure" as const,
          code: "MEMBERSHIP_LOOKUP_UNAVAILABLE" as const,
        };
      });
    }

    const decision = this.planner.forExplicitHouseholdRequest({
      eventId: event.eventId,
      householdId: event.householdId,
      transactionId: event.transactionId,
      creatorMemberId: event.requesterMemberId,
      requesterMemberId: event.requesterMemberId,
      members: memberIds.map((memberId) => ({
        householdId: event.householdId,
        memberId,
        status:
          membershipByMemberId.get(memberId) === "active"
            ? "active"
            : "removed",
      })),
      endpoints: endpoints.map((endpoint) => ({
        endpointId: endpoint.endpointId,
        householdId: endpoint.householdId,
        memberId: endpoint.memberId,
        platform: endpoint.platform,
        status: endpoint.status,
      })),
    });
    if (decision.kind === "ContractFailure") {
      throw new Error(`Invalid household notification event: ${decision.code}`);
    }

    const intentId = intentIdFor(event.eventId);
    const endpointsById = new Map(
      endpoints.map((endpoint) => [endpoint.endpointId, endpoint]),
    );
    const deliveries: StoredAssuredDelivery[] =
      decision.kind === "Recipients"
        ? decision.targets.map((target) => {
            const endpoint = endpointsById.get(target.endpointId);
            if (endpoint === undefined) {
              throw new Error(`Missing planned endpoint: ${target.endpointId}`);
            }
            return {
              deliveryId: deliveryIdFor(event.eventId, endpoint.endpointId),
              intentId,
              eventId: event.eventId,
              householdId: event.householdId,
              recipientMemberId: target.recipientMemberId,
              endpointId: endpoint.endpointId,
              expectedRegistrationVersion: endpoint.registrationVersion,
              expectedBindingVersion: endpoint.bindingVersion,
              status: "queued",
              providerAttemptCount: 0,
            };
          })
        : [];

    return this.store.runAcceptance(event.eventId, async (transaction) => {
      const concurrent = await transaction.readInbox();
      if (concurrent !== null) {
        const replay = replayAcceptedInbox(concurrent);
        if (replay !== null) {
          return replay;
        }
      }

      await transaction.saveIntent({
        intentId,
        eventId: event.eventId,
        householdId: event.householdId,
        status: deliveries.length === 0 ? "terminal" : "pending",
        ...(deliveries.length === 0 ? terminalRetention(now) : {}),
      });
      await transaction.saveDeliveries(deliveries);
      await transaction.saveInbox({
        eventId: event.eventId,
        status: deliveries.length === 0 ? "terminal" : "accepted",
        ...(deliveries.length === 0 ? { code: "NO_TARGET" } : {}),
        ...(deliveries.length === 0 ? terminalRetention(now) : {}),
        intentId,
        deliveryIds: deliveries.map((delivery) => delivery.deliveryId),
      });

      return deliveries.length === 0
        ? { kind: "NoTarget", intentId }
        : {
            kind: "Queued",
            intentId,
            deliveryIds: deliveries.map((delivery) => delivery.deliveryId),
          };
    });
  }

  async deliver(deliveryId: string): Promise<DeliverNotificationResult> {
    const claim = await this.store.runForDelivery<DeliveryClaim>(
      deliveryId,
      async (transaction) => {
        const delivery = await transaction.readDelivery();
        if (delivery === null) {
          throw new Error(`Notification delivery not found: ${deliveryId}`);
        }
        if (isTerminal(delivery)) {
          return { kind: "terminal", delivery };
        }
        if (delivery.status === "sending") {
          return { kind: "in-progress" };
        }

        const endpoint = await transaction.readEndpoint(delivery.endpointId);
        if (
          endpoint === null ||
          endpoint.status !== "active" ||
          endpoint.registrationVersion !== delivery.expectedRegistrationVersion ||
          endpoint.bindingVersion !== delivery.expectedBindingVersion
        ) {
          const terminal = terminalDelivery(
            delivery,
            { status: "stale-target", errorCode: "ENDPOINT_CHANGED" },
            0,
            this.clock.now(),
          );
          await transaction.saveDelivery(terminal);
          return { kind: "terminal", delivery: terminal };
        }

        const sending = { ...delivery, status: "sending" as const };
        await transaction.saveDelivery(sending);
        return { kind: "claimed", delivery: sending, endpoint };
      },
    );

    if (claim.kind === "terminal") {
      return toDeliveryResult(claim.delivery);
    }
    if (claim.kind === "in-progress") {
      return toDeliveryResult(
        await this.store.waitForTerminalDelivery(deliveryId),
      );
    }

    const membershipStatus = await this.memberships.status(
      claim.delivery.householdId,
      claim.delivery.recipientMemberId,
    );
    if (membershipStatus === "removed") {
      return toDeliveryResult(
        await this.completeDelivery(
          claim.delivery,
          {
            status: "stale-target",
            errorCode: "RECIPIENT_MEMBERSHIP_INACTIVE",
          },
          0,
        ),
      );
    }
    if (membershipStatus === "unavailable") {
      return toDeliveryResult(
        await this.completeDelivery(
          claim.delivery,
          {
            status: "failed",
            errorCode: "MEMBERSHIP_CHECK_UNAVAILABLE",
          },
          0,
        ),
      );
    }

    const providerOutcome = await this.provider.sendOne({
      deliveryId: claim.delivery.deliveryId,
      endpointId: claim.endpoint.endpointId,
      fid: claim.endpoint.fid,
    });
    return toDeliveryResult(
      await this.completeDelivery(
        claim.delivery,
        classifyProviderOutcome(providerOutcome),
        1,
        providerOutcome,
      ),
    );
  }

  async completeIntent(intentId: string): Promise<void> {
    const intent = await this.store.readIntent(intentId);
    if (intent === null) {
      throw new Error(`Notification intent not found: ${intentId}`);
    }
    if (
      intent.status === "terminal" &&
      intent.terminalAt !== undefined &&
      intent.expiresAt !== undefined
    ) {
      return;
    }
    const deliveries = await this.store.listIntentDeliveries(intentId);
    if (deliveries.some((delivery) => !isTerminal(delivery))) {
      throw new Error("NOTIFICATION_INTENT_IN_PROGRESS");
    }
    await this.store.completeIntent({
      intentId,
      eventId: intent.eventId,
      ...terminalRetention(this.clock.now()),
    });
  }

  async getDeliveryStatus(
    intentId: string,
  ): Promise<DeliveryStatusView | undefined> {
    const intent = await this.store.readIntent(intentId);
    if (intent === null) {
      return undefined;
    }
    const deliveries = (await this.store.listIntentDeliveries(intentId))
      .slice()
      .sort((left, right) =>
        left.recipientMemberId === right.recipientMemberId
          ? left.endpointId.localeCompare(right.endpointId)
          : left.recipientMemberId.localeCompare(right.recipientMemberId),
      );
    return {
      intentId,
      status: aggregateDeliveryStatuses(
        deliveries.map((delivery) => delivery.status),
      ),
      deliveries: deliveries.map(deliveryView),
    };
  }

  async listDeliveryStatuses(
    householdId: string,
  ): Promise<readonly DeliveryStatusView[]> {
    const intents = (await this.store.listIntents(householdId))
      .slice()
      .sort((left, right) => left.intentId.localeCompare(right.intentId));
    const statuses = await Promise.all(
      intents.map((intent) => this.getDeliveryStatus(intent.intentId)),
    );
    return statuses.filter(
      (status): status is DeliveryStatusView => status !== undefined,
    );
  }

  async listEndpointStatuses(
    householdId: string,
  ): Promise<readonly PublicEndpointStatusView[]> {
    return (await this.store.listEndpoints(householdId))
      .slice()
      .sort((left, right) => left.endpointId.localeCompare(right.endpointId))
      .map((endpoint) => ({
        endpointId: endpoint.endpointId,
        status: endpoint.status,
        registrationVersion: endpoint.registrationVersion,
        bindingVersion: endpoint.bindingVersion,
      }));
  }

  async getInboxStatus(
    eventId: string,
  ): Promise<NotificationInboxStatusView | undefined> {
    const inbox = await this.store.readInbox(eventId);
    return inbox === null
      ? undefined
      : {
          eventId: inbox.eventId,
          status: inbox.status,
          ...(inbox.code === undefined ? {} : { code: inbox.code }),
          ...(inbox.terminalAt === undefined
            ? {}
            : { terminalAt: inbox.terminalAt }),
          ...(inbox.expiresAt === undefined
            ? {}
            : { expiresAt: inbox.expiresAt }),
        };
  }

  async getTerminalRetentionDisposition(
    deliveryId: string,
    now: string,
  ): Promise<"retain" | "eligible-for-ttl-deletion"> {
    const delivery = await this.store.readDelivery(deliveryId);
    if (delivery === null) {
      throw new Error(`Notification delivery not found: ${deliveryId}`);
    }
    return terminalRetentionDisposition(delivery.expiresAt, now);
  }

  private async completeDelivery(
    delivery: StoredAssuredDelivery,
    outcome: ClassifiedDeliveryOutcome,
    providerAttemptCount: 0 | 1,
    providerOutcome?: NotificationProviderOutcome,
  ): Promise<StoredAssuredDelivery> {
    return this.store.runForDelivery(delivery.deliveryId, async (transaction) => {
      const current = await transaction.readDelivery();
      if (current === null) {
        throw new Error(`Notification delivery not found: ${delivery.deliveryId}`);
      }
      if (isTerminal(current)) {
        return current;
      }

      const terminal = terminalDelivery(
        current,
        outcome,
        providerAttemptCount,
        this.clock.now(),
      );
      await transaction.saveDelivery(terminal);

      if (
        providerOutcome?.kind === "http-error" &&
        providerOutcome.httpStatus === 404 &&
        providerOutcome.code === "UNREGISTERED"
      ) {
        await this.applyEndpointInactivation(transaction, terminal, providerOutcome);
      }
      return terminal;
    });
  }

  private async applyEndpointInactivation(
    transaction: AssuredDeliveryTransaction,
    delivery: StoredAssuredDelivery,
    outcome: Extract<NotificationProviderOutcome, { kind: "http-error" }>,
  ): Promise<void> {
    const current = await transaction.readEndpoint(delivery.endpointId);
    const decision = decideEndpointInactivation({
      current,
      expectedRegistrationVersion: delivery.expectedRegistrationVersion,
      expectedBindingVersion: delivery.expectedBindingVersion,
      now: this.clock.now(),
      observation: {
        source: "provider",
        httpStatus: outcome.httpStatus,
        code: outcome.code,
      },
    });
    if (decision.kind === "Inactivated") {
      await transaction.saveEndpoint(decision.endpoint);
    }
  }
}

export function createDeliveryAssuranceApplication(
  planner: NotificationTargetPlanner,
  memberships: DeliveryMembershipQueryPort,
  store: DeliveryAssuranceStore,
  provider: DeliveryAssuranceProviderPort,
  clock: DeliveryAssuranceClock,
): DeliveryAssuranceInputPort {
  return new DefaultDeliveryAssuranceApplication(
    planner,
    memberships,
    store,
    provider,
    clock,
  );
}
