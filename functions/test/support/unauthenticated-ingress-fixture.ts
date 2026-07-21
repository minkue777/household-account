import { createProtectedIngressApplication } from "../../src/platform/ingress-security/application/protectedIngressApplication";
import type {
  AppAttestationVerificationPort,
  AuthorizedIngressDispatcherPort,
  IngressCredentialVerificationPort,
} from "../../src/platform/ingress-security/application/ports/out/ingressSecurityPorts";
import type { VerifiedIngressPrincipal } from "../../src/platform/ingress-security/domain/model/protectedIngress";
import type {
  ProtectedIngress,
  ProtectedIngressInputPort,
  ProtectedIngressResult,
} from "../../src/platform/ingress-security/public";

export interface ProtectedIngressSnapshot {
  accessDigest: string;
  notificationEndpointDigest: string;
  shortcutReceiptDigest: string;
  dividendSnapshotDigest: string;
}

export interface ProtectedIngressEvent {
  eventType: string;
  resourceId: string;
}

export interface UnauthenticatedIngressFixtureSubject
  extends ProtectedIngressInputPort {
  snapshot(): Promise<ProtectedIngressSnapshot>;
  publishedEvents(): Promise<readonly ProtectedIngressEvent[]>;
}

class FixtureCredentialVerifier implements IngressCredentialVerificationPort {
  private readonly principals: Readonly<Record<string, VerifiedIngressPrincipal>> = {
    "Bearer member-credential": {
      principalRef: "uid-member",
      capabilities: [
        "notifications:endpoint:register",
        "household:self:rename",
      ],
      activeMembership: true,
    },
    "Bearer shortcut-credential": {
      principalRef: "uid-shortcut-member",
      capabilities: ["paymentCapture:submit"],
      activeMembership: true,
    },
    "Bearer no-capability": {
      principalRef: "uid-no-capability",
      capabilities: [],
      activeMembership: true,
    },
    "Bearer removed-member": {
      principalRef: "uid-removed-member",
      capabilities: [
        "notifications:endpoint:register",
        "household:self:rename",
        "paymentCapture:submit",
      ],
      activeMembership: false,
    },
  };

  async verify(
    authorization: string,
  ): Promise<VerifiedIngressPrincipal | undefined> {
    const principal = this.principals[authorization];
    return principal === undefined
      ? undefined
      : { ...principal, capabilities: [...principal.capabilities] };
  }
}

class FixtureAppAttestationVerifier
  implements AppAttestationVerificationPort
{
  async verify(appAttestation: string): Promise<boolean> {
    return appAttestation === "valid-app-attestation";
  }
}

class RecordingAuthorizedIngressDispatcher
  implements AuthorizedIngressDispatcherPort
{
  private readonly counts: Record<ProtectedIngress, number> = {
    RegisterEndpoint: 0,
    RenameSelf: 0,
    SubmitShortcutCapture: 0,
    SaveDividendSnapshot: 0,
  };
  private readonly eventsValue: ProtectedIngressEvent[] = [];

  async dispatch(input: {
    entryPoint: ProtectedIngress;
    principal: VerifiedIngressPrincipal;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<Extract<ProtectedIngressResult, { kind: "success" }>> {
    this.counts[input.entryPoint] += 1;
    const resourceId = `${input.entryPoint}:${this.counts[input.entryPoint]}`;
    this.eventsValue.push({
      eventType: `${input.entryPoint}Accepted.v1`,
      resourceId,
    });
    return { kind: "success", resourceId };
  }

  snapshot(): ProtectedIngressSnapshot {
    return {
      accessDigest: `access:${this.counts.RenameSelf}`,
      notificationEndpointDigest: `notifications:${this.counts.RegisterEndpoint}`,
      shortcutReceiptDigest: `shortcut:${this.counts.SubmitShortcutCapture}`,
      dividendSnapshotDigest: `dividend:${this.counts.SaveDividendSnapshot}`,
    };
  }

  events(): readonly ProtectedIngressEvent[] {
    return this.eventsValue.map((event) => ({ ...event }));
  }
}

class UnauthenticatedIngressFixtureDriver
  implements UnauthenticatedIngressFixtureSubject
{
  constructor(
    private readonly application: ProtectedIngressInputPort,
    private readonly dispatcher: RecordingAuthorizedIngressDispatcher,
  ) {}

  supportedPublicIngresses(): readonly ProtectedIngress[] {
    return this.application.supportedPublicIngresses();
  }

  invoke(...args: Parameters<ProtectedIngressInputPort["invoke"]>) {
    return this.application.invoke(...args);
  }

  async snapshot(): Promise<ProtectedIngressSnapshot> {
    return this.dispatcher.snapshot();
  }

  async publishedEvents(): Promise<readonly ProtectedIngressEvent[]> {
    return this.dispatcher.events();
  }
}

export function createUnauthenticatedIngressFixtureSubject(): UnauthenticatedIngressFixtureSubject {
  const dispatcher = new RecordingAuthorizedIngressDispatcher();
  return new UnauthenticatedIngressFixtureDriver(
    createProtectedIngressApplication({
      credentials: new FixtureCredentialVerifier(),
      appAttestation: new FixtureAppAttestationVerifier(),
      dispatcher,
    }),
    dispatcher,
  );
}
