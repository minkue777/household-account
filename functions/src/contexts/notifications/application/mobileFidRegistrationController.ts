import type {
  ClientCapabilityResult,
  ClientEndpointResult,
  MobileFidRegistrationInputPort,
  MobileSessionScope,
  RegisterMobileFidInput,
  UnregisterMobileFidInput,
} from "./ports/in/mobileFidRegistrationPort";
import type {
  MobileEndpointClock,
  MobileEndpointIdentityPort,
  MobileEndpointRegistrationStore,
} from "./ports/outbound/mobileEndpointRegistrationStore";
import { decideEndpointInactivation } from "../domain/policies/endpointInactivationPolicy";
import { decideEndpointRegistration } from "../domain/policies/endpointRegistrationPolicy";
import { evaluateMobileRegistrationCapability } from "../domain/policies/mobileRegistrationCapability";

const REGISTRATION_SURFACE = [
  "register",
  "onRegistered",
  "onUnregistered",
  "logout",
] as const;

function sameBinding(
  session: MobileSessionScope,
  endpoint: { householdId: string; memberId: string },
): boolean {
  return (
    session.householdId === endpoint.householdId &&
    session.memberId === endpoint.memberId
  );
}

class DefaultMobileFidRegistrationController
  implements MobileFidRegistrationInputPort
{
  private session: MobileSessionScope | undefined;

  constructor(
    private readonly store: MobileEndpointRegistrationStore,
    private readonly identity: MobileEndpointIdentityPort,
    private readonly clock: MobileEndpointClock,
  ) {}

  supportedRegistrationSurface(): readonly string[] {
    return [...REGISTRATION_SURFACE];
  }

  evaluateEnvironment(input: {
    runtime: RegisterMobileFidInput["runtime"];
    osNotificationPermission: RegisterMobileFidInput["osNotificationPermission"];
  }): ClientCapabilityResult {
    const capability = evaluateMobileRegistrationCapability(input);
    return capability.kind === "eligible"
      ? {
          kind: "eligible",
          platform: capability.platform,
          registrationMechanism: "firebase-installation-id",
        }
      : capability;
  }

  restoreSession(session: MobileSessionScope): void {
    this.session = { ...session };
  }

  async onRegistered(
    input: RegisterMobileFidInput,
  ): Promise<ClientEndpointResult> {
    const capability = evaluateMobileRegistrationCapability(input);
    if (capability.kind === "not-eligible") {
      return { kind: "ignored", reason: "RUNTIME_NOT_ELIGIBLE" };
    }
    if (this.session === undefined) {
      return { kind: "ignored", reason: "SESSION_REQUIRED" };
    }

    const fid = input.fid.trim();
    if (fid.length === 0) {
      return { kind: "validation-error", code: "FID_REQUIRED" };
    }

    const endpointId = this.identity.endpointIdFor(fid);
    const session = this.session;
    return this.store.runForEndpoint(endpointId, async (transaction) => {
      const current = await transaction.read();
      const decision = decideEndpointRegistration(current, {
        endpointId,
        fid,
        binding: {
          householdId: session.householdId,
          memberId: session.memberId,
        },
        platform: capability.platform,
        deviceInfo: input.deviceInfo,
        confirmedAt: this.clock.now(),
      });
      await transaction.save(decision.endpoint);

      return {
        kind: "registered",
        endpointId,
        registrationVersion: decision.endpoint.registrationVersion,
        result: decision.result,
      };
    });
  }

  async onUnregistered(
    input: UnregisterMobileFidInput,
  ): Promise<ClientEndpointResult> {
    if (this.session === undefined) {
      return { kind: "ignored", reason: "SESSION_REQUIRED" };
    }

    const fid = input.fid.trim();
    if (fid.length === 0) {
      return { kind: "validation-error", code: "FID_REQUIRED" };
    }

    const endpointId = this.identity.endpointIdFor(fid);
    const session = this.session;
    return this.store.runForEndpoint(endpointId, async (transaction) => {
      const current = await transaction.read();
      if (current === null) {
        return { kind: "already-absent" };
      }
      if (
        !sameBinding(session, current) ||
        current.registrationVersion !== input.expectedRegistrationVersion
      ) {
        return { kind: "stale-ignored", endpointId };
      }

      const decision = decideEndpointInactivation({
        current,
        expectedRegistrationVersion: input.expectedRegistrationVersion,
        expectedBindingVersion: current.bindingVersion,
        now: this.clock.now(),
        observation: { source: "sdk-unregistered" },
      });
      if (decision.kind !== "Inactivated") {
        return { kind: "stale-ignored", endpointId };
      }

      await transaction.save(decision.endpoint);
      return { kind: "inactivated", endpointId };
    });
  }

  async logoutCurrentInstallation(
    rawFid: string,
  ): Promise<ClientEndpointResult> {
    if (this.session === undefined) {
      return { kind: "ignored", reason: "SESSION_REQUIRED" };
    }

    const fid = rawFid.trim();
    if (fid.length === 0) {
      return { kind: "validation-error", code: "FID_REQUIRED" };
    }

    const endpointId = this.identity.endpointIdFor(fid);
    const session = this.session;
    return this.store.runForEndpoint(endpointId, async (transaction) => {
      const current = await transaction.read();
      if (current === null) {
        return { kind: "already-absent" };
      }
      if (!sameBinding(session, current)) {
        return { kind: "stale-ignored", endpointId };
      }

      await transaction.remove();
      return { kind: "removed", endpointId };
    });
  }
}

export function createMobileFidRegistrationController(
  store: MobileEndpointRegistrationStore,
  identity: MobileEndpointIdentityPort,
  clock: MobileEndpointClock,
): MobileFidRegistrationInputPort {
  return new DefaultMobileFidRegistrationController(store, identity, clock);
}
