import type {
  ShortcutTransactionNotificationInputPort,
  ShortcutTransactionNotificationResult,
  ShortcutTransactionRecordedEvent,
} from "./ports/in/shortcutTransactionNotificationPort";
import type {
  ShortcutDeliveryRecord,
  ShortcutProviderOutcome,
  ShortcutTransactionNotificationProvider,
  ShortcutTransactionNotificationStore,
  ShortcutNotificationFactsQuery,
} from "./ports/outbound/shortcutTransactionNotificationPorts";
import type { NotificationTargetPlanner } from "./planNotificationTargets";

function publicResult(
  outcome: ShortcutProviderOutcome,
  transactionId: string,
): ShortcutTransactionNotificationResult {
  switch (outcome) {
    case "delivered":
      return { kind: "Delivered", transactionId };
    case "failed":
      return { kind: "Failed", transactionId };
    case "unknown-provider-outcome":
      return { kind: "UnknownProviderOutcome", transactionId };
    case "permanent-failure":
      return { kind: "PermanentFailure", transactionId };
    case "contract-failure":
      return { kind: "ContractFailure", transactionId };
  }
}

function aggregateOutcomes(
  outcomes: readonly ShortcutProviderOutcome[],
): ShortcutProviderOutcome {
  if (outcomes.every((outcome) => outcome === "delivered")) {
    return "delivered";
  }
  if (outcomes.includes("unknown-provider-outcome")) {
    return "unknown-provider-outcome";
  }
  if (outcomes.includes("permanent-failure")) {
    return "permanent-failure";
  }
  if (outcomes.includes("contract-failure")) {
    return "contract-failure";
  }
  return "failed";
}

class DefaultShortcutTransactionNotificationConsumer
  implements ShortcutTransactionNotificationInputPort
{
  constructor(
    private readonly planner: NotificationTargetPlanner,
    private readonly facts: ShortcutNotificationFactsQuery,
    private readonly store: ShortcutTransactionNotificationStore,
    private readonly provider: ShortcutTransactionNotificationProvider,
  ) {}

  async consume(
    event: ShortcutTransactionRecordedEvent,
  ): Promise<ShortcutTransactionNotificationResult> {
    const notificationFacts = await this.facts.load(event.householdId);
    const decision = this.planner.forRecordedTransaction({
      eventId: event.eventId,
      householdId: event.householdId,
      transactionId: event.transactionId,
      transactionType: "expense",
      originChannel: event.originChannel,
      creatorMemberId: event.creatorMemberId,
      members: notificationFacts.members,
      endpoints: notificationFacts.endpoints.map((endpoint) => ({
        endpointId: endpoint.endpointId,
        householdId: endpoint.householdId,
        memberId: endpoint.memberId,
        platform: endpoint.platform,
        status: endpoint.status,
      })),
    });
    if (decision.kind !== "Recipients") {
      throw new Error(
        `Shortcut transaction notification target unavailable: ${decision.kind}`,
      );
    }

    const endpointsById = new Map(
      notificationFacts.endpoints.map((endpoint) => [
        endpoint.endpointId,
        endpoint,
      ]),
    );
    const deliveries: ShortcutDeliveryRecord[] = decision.targets.map(
      (target) => {
        const endpoint = endpointsById.get(target.endpointId);
        if (endpoint === undefined) {
          throw new Error(
            `Notification endpoint disappeared while planning: ${target.endpointId}`,
          );
        }
        return {
          eventId: event.eventId,
          transactionId: event.transactionId,
          endpointId: endpoint.endpointId,
          fid: endpoint.fid,
          expectedRegistrationVersion: endpoint.registrationVersion,
          expectedBindingVersion: endpoint.bindingVersion,
          status: "queued",
        };
      },
    );

    const claim = await this.store.claimEvent({
      eventId: event.eventId,
      transactionId: event.transactionId,
      deliveries,
    });
    if (claim.kind === "completed") {
      return publicResult(claim.outcome, event.transactionId);
    }
    if (claim.kind === "in-progress") {
      return publicResult(
        await this.store.waitForCompletion(event.eventId),
        event.transactionId,
      );
    }

    const completedDeliveries = await Promise.all(
      claim.deliveries.map(async (delivery) => ({
        ...delivery,
        status: await this.provider.sendOne({
          eventId: delivery.eventId,
          endpointId: delivery.endpointId,
          fid: delivery.fid,
        }),
      })),
    );
    const outcome = aggregateOutcomes(
      completedDeliveries.map((delivery) => delivery.status),
    );
    await this.store.completeEvent({
      eventId: event.eventId,
      outcome,
      deliveries: completedDeliveries,
    });
    return publicResult(outcome, event.transactionId);
  }
}

export function createShortcutTransactionNotificationConsumer(
  planner: NotificationTargetPlanner,
  facts: ShortcutNotificationFactsQuery,
  store: ShortcutTransactionNotificationStore,
  provider: ShortcutTransactionNotificationProvider,
): ShortcutTransactionNotificationInputPort {
  return new DefaultShortcutTransactionNotificationConsumer(
    planner,
    facts,
    store,
    provider,
  );
}
