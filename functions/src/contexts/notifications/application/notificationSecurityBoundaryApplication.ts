import type {
  ExplicitNotificationRequest,
  ExplicitRequestResult,
  HouseholdDeliveryStatusQueryResult,
  HouseholdMemberRemovedEvent,
  MemberCleanupResult,
  NotificationsSecurityBoundaryInputPort,
  PublicEndpointView,
  SecuredRegisterEndpointCommand,
  SecuredRegisterEndpointResult,
  SecuredRemoveEndpointInput,
  SecuredRemoveEndpointResult,
  TerminalDeliveryView,
} from "./ports/in/notificationSecurityBoundaryPort";
import type { MobileEndpointIdentityPort } from "./ports/outbound/mobileEndpointRegistrationStore";
import type {
  NotificationMembershipQueryPort,
  NotificationSecurityClock,
  NotificationSecurityStore,
  SafeNotificationObservabilityPort,
  StoredSecurityDelivery,
} from "./ports/outbound/notificationSecurityPorts";
import { decideEndpointRegistration } from "../domain/policies/endpointRegistrationPolicy";
import {
  isCurrentEndpointActor,
  validateSecuredRegistrationPreflight,
} from "../domain/policies/endpointCommandSecurityPolicy";

function registrationFingerprint(
  command: SecuredRegisterEndpointCommand,
  endpointId: string,
): string {
  return JSON.stringify([
    command.principal?.uid ?? null,
    command.targetHouseholdId,
    command.targetMemberId,
    endpointId,
    command.platform,
  ]);
}

function toPublicEndpointView(endpoint: {
  endpointId: string;
  householdId: string;
  memberId: string;
  platform: PublicEndpointView["platform"];
  status: PublicEndpointView["status"];
  registrationVersion: number;
  bindingVersion: number;
}): PublicEndpointView {
  return {
    endpointId: endpoint.endpointId,
    householdId: endpoint.householdId,
    memberId: endpoint.memberId,
    platform: endpoint.platform,
    status: endpoint.status,
    registrationVersion: endpoint.registrationVersion,
    bindingVersion: endpoint.bindingVersion,
  };
}

function toTerminalDeliveryView(
  delivery: StoredSecurityDelivery,
): TerminalDeliveryView | null {
  if (delivery.status === "queued") {
    return null;
  }
  return {
    deliveryId: delivery.deliveryId,
    householdId: delivery.householdId,
    recipientMemberId: delivery.recipientMemberId,
    endpointId: delivery.endpointId,
    status: delivery.status,
    providerAttemptCount: delivery.providerAttemptCount,
  };
}

class DefaultNotificationSecurityBoundaryApplication
  implements NotificationsSecurityBoundaryInputPort
{
  constructor(
    private readonly memberships: NotificationMembershipQueryPort,
    private readonly store: NotificationSecurityStore,
    private readonly identity: MobileEndpointIdentityPort,
    private readonly clock: NotificationSecurityClock,
    private readonly observability: SafeNotificationObservabilityPort,
  ) {}

  async register(
    command: SecuredRegisterEndpointCommand,
  ): Promise<SecuredRegisterEndpointResult> {
    const preflight = validateSecuredRegistrationPreflight(command);
    if (preflight.kind !== "AuthorizedForMembershipCheck") {
      return preflight;
    }
    if (
      this.memberships.status(
        command.targetHouseholdId,
        command.targetMemberId,
      ) !== "active"
    ) {
      return { kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" };
    }

    const fid = command.fid.trim();
    const endpointId = this.identity.endpointIdFor(fid);
    const payloadFingerprint = registrationFingerprint(command, endpointId);
    const platform =
      command.platform === "android" ? "android" : "ios-pwa";

    const result = await this.store.runEndpointCommand(
      command.commandId,
      endpointId,
      async (transaction): Promise<SecuredRegisterEndpointResult> => {
        const receipt = await transaction.readRegistrationReceipt(
          command.idempotencyKey,
        );
        if (receipt !== null) {
          return receipt.payloadFingerprint === payloadFingerprint
            ? receipt.result
            : {
                kind: "Conflict",
                code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
              };
        }

        const current = await transaction.readEndpoint();
        const decision = decideEndpointRegistration(current, {
          endpointId,
          fid,
          binding: {
            householdId: command.targetHouseholdId,
            memberId: command.targetMemberId,
          },
          platform,
          deviceInfo: {},
          confirmedAt: this.clock.now(),
        });
        const registeredResult = {
          kind: "EndpointRegistered" as const,
          endpointId,
          result: decision.result,
        };

        await transaction.saveEndpoint(decision.endpoint);
        await transaction.saveRegistrationReceipt({
          idempotencyKey: command.idempotencyKey,
          payloadFingerprint,
          result: registeredResult,
        });
        return registeredResult;
      },
    );

    this.observability.record({
      name: "notification-endpoint-registration",
      endpointId,
      resultCode: result.kind,
    });
    return result;
  }

  async remove(
    input: SecuredRemoveEndpointInput,
  ): Promise<SecuredRemoveEndpointResult> {
    const membershipStatus =
      input.principal === undefined
        ? "missing"
        : this.memberships.status(
            input.targetHouseholdId,
            input.targetMemberId,
          );
    const authorization = isCurrentEndpointActor({
      principal: input.principal,
      targetHouseholdId: input.targetHouseholdId,
      targetMemberId: input.targetMemberId,
      membershipStatus,
    });
    if (authorization.kind !== "Authorized") {
      return authorization;
    }

    const endpointId = this.identity.endpointIdFor(input.fid.trim());
    const result = await this.store.runEndpointCommand(
      undefined,
      endpointId,
      async (transaction): Promise<SecuredRemoveEndpointResult> => {
        const current = await transaction.readEndpoint();
        if (current === null) {
          return { kind: "AlreadyAbsent" };
        }
        if (
          current.householdId !== input.targetHouseholdId ||
          current.memberId !== input.targetMemberId
        ) {
          return { kind: "Conflict", code: "ENDPOINT_BINDING_MISMATCH" };
        }

        await transaction.removeEndpoint();
        return { kind: "Removed" };
      },
    );

    this.observability.record({
      name: "notification-endpoint-removal",
      endpointId,
      resultCode: result.kind,
    });
    return result;
  }

  async acceptExplicitRequest(
    event: ExplicitNotificationRequest,
  ): Promise<ExplicitRequestResult> {
    const endpoints = (await this.store.listEndpoints(event.householdId))
      .filter(
        (endpoint) =>
          endpoint.status === "active" &&
          endpoint.memberId !== event.requesterMemberId &&
          this.memberships.status(endpoint.householdId, endpoint.memberId) ===
            "active",
      )
      .sort((left, right) =>
        left.memberId === right.memberId
          ? left.endpointId.localeCompare(right.endpointId)
          : left.memberId.localeCompare(right.memberId),
      );
    if (endpoints.length === 0) {
      return { kind: "NoTarget" };
    }

    const intentId = `intent:${encodeURIComponent(event.eventId)}`;
    const deliveries = endpoints.map((endpoint) => ({
      deliveryId: `delivery:${encodeURIComponent(event.eventId)}:${endpoint.endpointId}`,
      householdId: event.householdId,
      recipientMemberId: endpoint.memberId,
      endpointId: endpoint.endpointId,
      status: "queued" as const,
      providerAttemptCount: 0 as const,
    }));
    await this.store.saveDeliveries(deliveries);
    return {
      kind: "Queued",
      intentId,
      deliveryIds: deliveries.map(({ deliveryId }) => deliveryId),
    };
  }

  async deliver(deliveryId: string): Promise<
    | { kind: "Delivered" }
    | { kind: "StaleTarget"; code: "RECIPIENT_MEMBERSHIP_INACTIVE" }
  > {
    const delivery = await this.store.readDelivery(deliveryId);
    if (delivery === null) {
      throw new Error("notification delivery not found");
    }

    if (
      this.memberships.status(
        delivery.householdId,
        delivery.recipientMemberId,
      ) !== "active"
    ) {
      await this.store.saveDelivery({
        ...delivery,
        status: "stale-target",
        providerAttemptCount: 0,
      });
      return {
        kind: "StaleTarget",
        code: "RECIPIENT_MEMBERSHIP_INACTIVE",
      };
    }

    await this.store.saveDelivery({
      ...delivery,
      status: "delivered",
      providerAttemptCount: 1,
    });
    return { kind: "Delivered" };
  }

  async getDeliveryStatus(input: {
    principal?: {
      uid: string;
      householdId: string;
      memberId: string;
    };
    householdId: string;
    deliveryId: string;
  }): Promise<HouseholdDeliveryStatusQueryResult> {
    if (
      input.principal === undefined ||
      input.principal.householdId !== input.householdId ||
      this.memberships.status(
        input.principal.householdId,
        input.principal.memberId,
      ) !== "active"
    ) {
      return { kind: "Forbidden", code: "HOUSEHOLD_ACCESS_DENIED" };
    }

    const delivery = await this.store.readDelivery(input.deliveryId);
    if (delivery === null || delivery.householdId !== input.householdId) {
      return { kind: "NotFound" };
    }
    const view = toTerminalDeliveryView(delivery);
    return view === null
      ? { kind: "NotFound" }
      : { kind: "Success", delivery: view };
  }

  async handleMemberRemoved(
    event: HouseholdMemberRemovedEvent,
  ): Promise<MemberCleanupResult> {
    if (event.producer !== "access-household.membership") {
      return { kind: "ContractFailure", code: "UNKNOWN_PRODUCER" };
    }
    if (event.schemaVersion !== 1) {
      return {
        kind: "ContractFailure",
        code: "UNSUPPORTED_EVENT_VERSION",
      };
    }
    if (event.systemCapability !== "household-member-cleanup") {
      return { kind: "Forbidden", code: "SYSTEM_CAPABILITY_REQUIRED" };
    }

    const cleanup = await this.store.cleanupMemberEndpoints(
      event.eventId,
      event.householdId,
      event.memberId,
    );
    return {
      kind: cleanup.replayed ? "AlreadyProcessed" : "Completed",
      removedEndpointCount: cleanup.removedEndpointCount,
    };
  }

  async listEndpointViews(
    householdId: string,
  ): Promise<readonly PublicEndpointView[]> {
    return (await this.store.listEndpoints(householdId))
      .slice()
      .sort((left, right) => left.endpointId.localeCompare(right.endpointId))
      .map(toPublicEndpointView);
  }

  async listTerminalDeliveries(
    householdId: string,
  ): Promise<readonly TerminalDeliveryView[]> {
    return (await this.store.listDeliveries(householdId))
      .map(toTerminalDeliveryView)
      .filter((delivery): delivery is TerminalDeliveryView => delivery !== null)
      .sort((left, right) => left.deliveryId.localeCompare(right.deliveryId));
  }
}

export function createNotificationSecurityBoundaryApplication(
  memberships: NotificationMembershipQueryPort,
  store: NotificationSecurityStore,
  identity: MobileEndpointIdentityPort,
  clock: NotificationSecurityClock,
  observability: SafeNotificationObservabilityPort,
): NotificationsSecurityBoundaryInputPort {
  return new DefaultNotificationSecurityBoundaryApplication(
    memberships,
    store,
    identity,
    clock,
    observability,
  );
}
