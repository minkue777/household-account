import type {
  EndpointClientCapabilityResult,
  EndpointLifecycleInputPort,
  EndpointView,
  MarkEndpointInactiveCommand,
  MarkEndpointInactiveResult,
  RegisterEndpointCommand,
  RegisterEndpointResult,
  RemoveEndpointCommand,
  RemoveEndpointResult,
} from "./ports/in/endpointLifecyclePort";
import type {
  EndpointCommandReceipt,
  EndpointLifecycleUnitOfWork,
} from "./ports/outbound/endpointLifecycleUnitOfWork";
import type { MobileEndpointIdentityPort } from "./ports/outbound/mobileEndpointRegistrationStore";
import { decideEndpointInactivation } from "../domain/policies/endpointInactivationPolicy";
import { decideEndpointRegistration } from "../domain/policies/endpointRegistrationPolicy";
import { evaluateMobileRegistrationCapability } from "../domain/policies/mobileRegistrationCapability";

function registerFingerprint(command: RegisterEndpointCommand): string {
  return JSON.stringify([
    command.actor.uid,
    command.actor.householdId,
    command.actor.memberId,
    command.appAttestation,
    command.fid.trim(),
    command.platform,
    command.now,
    command.deviceInfo?.model ?? null,
    command.deviceInfo?.osVersion ?? null,
    command.deviceInfo?.appVersion ?? null,
  ]);
}

function removeFingerprint(command: RemoveEndpointCommand): string {
  return JSON.stringify([
    command.actor.uid,
    command.actor.householdId,
    command.actor.memberId,
    command.fid.trim(),
  ]);
}

function endpointView(endpoint: {
  endpointId: string;
  householdId: string;
  memberId: string;
  platform: EndpointView["platform"];
  status: EndpointView["status"];
  registrationVersion: number;
  bindingVersion: number;
  lastConfirmedAt: string;
  inactiveAt?: string;
  expiresAt?: string;
}): EndpointView {
  return {
    endpointId: endpoint.endpointId,
    householdId: endpoint.householdId,
    memberId: endpoint.memberId,
    platform: endpoint.platform,
    status: endpoint.status,
    registrationVersion: endpoint.registrationVersion,
    bindingVersion: endpoint.bindingVersion,
    lastConfirmedAt: endpoint.lastConfirmedAt,
    ...(endpoint.inactiveAt === undefined
      ? {}
      : { inactiveAt: endpoint.inactiveAt }),
    ...(endpoint.expiresAt === undefined
      ? {}
      : { expiresAt: endpoint.expiresAt }),
  };
}

class DefaultEndpointLifecycleApplication
  implements EndpointLifecycleInputPort
{
  constructor(
    private readonly unitOfWork: EndpointLifecycleUnitOfWork,
    private readonly identity: MobileEndpointIdentityPort,
  ) {}

  evaluateClientCapability(input: {
    runtime: "android-app" | "ios-home-screen-pwa" | "desktop-web";
    osNotificationPermission: "granted" | "denied";
  }): EndpointClientCapabilityResult {
    const capability = evaluateMobileRegistrationCapability(input);
    if (capability.kind === "eligible") {
      return { kind: "Eligible", platform: capability.platform };
    }
    return {
      kind: "NotEligible",
      reason:
        capability.reason === "DESKTOP_NOT_SUPPORTED"
          ? "DESKTOP_NOT_SUPPORTED"
          : "IOS_PERMISSION_REQUIRED",
    };
  }

  async register(
    command: RegisterEndpointCommand,
  ): Promise<RegisterEndpointResult> {
    const fid = command.fid.trim();
    const endpointId = this.identity.endpointIdFor(fid);
    const payloadFingerprint = registerFingerprint(command);

    return this.unitOfWork.runForEndpoint(endpointId, async (transaction) => {
      const receipt = await transaction.readReceipt(command.idempotencyKey);
      if (receipt !== null) {
        return receipt.commandType === "register" &&
          receipt.payloadFingerprint === payloadFingerprint
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
          householdId: command.actor.householdId,
          memberId: command.actor.memberId,
        },
        platform: command.platform,
        deviceInfo: command.deviceInfo ?? {},
        confirmedAt: command.now,
      });
      const result: RegisterEndpointResult = {
        kind: "EndpointRegistered",
        endpointId,
        result: decision.result,
        registrationVersion: decision.endpoint.registrationVersion,
      };
      const savedReceipt: EndpointCommandReceipt = {
        commandType: "register",
        idempotencyKey: command.idempotencyKey,
        payloadFingerprint,
        result,
      };

      await transaction.saveEndpoint(decision.endpoint);
      await transaction.saveReceipt(savedReceipt);
      return result;
    });
  }

  async remove(command: RemoveEndpointCommand): Promise<RemoveEndpointResult> {
    const fid = command.fid.trim();
    const endpointId = this.identity.endpointIdFor(fid);
    const payloadFingerprint = removeFingerprint(command);

    return this.unitOfWork.runForEndpoint(endpointId, async (transaction) => {
      const receipt = await transaction.readReceipt(command.idempotencyKey);
      if (receipt !== null) {
        return receipt.commandType === "remove" &&
          receipt.payloadFingerprint === payloadFingerprint
          ? receipt.result
          : { kind: "Conflict", code: "ENDPOINT_BINDING_MISMATCH" };
      }

      const current = await transaction.readEndpoint();
      let result: RemoveEndpointResult;
      if (current === null) {
        result = { kind: "AlreadyAbsent" };
      } else if (
        current.householdId !== command.actor.householdId ||
        current.memberId !== command.actor.memberId
      ) {
        result = { kind: "Conflict", code: "ENDPOINT_BINDING_MISMATCH" };
      } else {
        result = { kind: "Removed", endpointId };
        await transaction.removeEndpoint();
      }

      await transaction.saveReceipt({
        commandType: "remove",
        idempotencyKey: command.idempotencyKey,
        payloadFingerprint,
        result,
      });
      return result;
    });
  }

  async markInactive(
    command: MarkEndpointInactiveCommand,
  ): Promise<MarkEndpointInactiveResult> {
    return this.unitOfWork.runForEndpoint(
      command.endpointId,
      async (transaction) => {
        const current = await transaction.readEndpoint();
        const decision = decideEndpointInactivation({
          current,
          expectedRegistrationVersion: command.expectedRegistrationVersion,
          expectedBindingVersion: command.expectedBindingVersion,
          now: command.now,
          observation: command.observation,
        });

        if (decision.kind === "Inactivated") {
          await transaction.saveEndpoint(decision.endpoint);
        }
        return { kind: decision.kind };
      },
    );
  }

  async listEndpointViews(
    householdId: string,
  ): Promise<readonly EndpointView[]> {
    const endpoints = await this.unitOfWork.listByHousehold(householdId);
    return endpoints
      .slice()
      .sort((left, right) => left.endpointId.localeCompare(right.endpointId))
      .map(endpointView);
  }
}

export function createEndpointLifecycleApplication(
  unitOfWork: EndpointLifecycleUnitOfWork,
  identity: MobileEndpointIdentityPort,
): EndpointLifecycleInputPort {
  return new DefaultEndpointLifecycleApplication(unitOfWork, identity);
}
