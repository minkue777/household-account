import type {
  ProtectedIngressInputPort,
  ProtectedIngressRequest,
  ProtectedIngressResult,
} from "./ports/in/protectedIngressInputPort";
import type {
  AppAttestationVerificationPort,
  AuthorizedIngressDispatcherPort,
  IngressCredentialVerificationPort,
} from "./ports/out/ingressSecurityPorts";
import {
  authorizePublicIngress,
  supportedPublicIngresses,
} from "../domain/policies/publicIngressAuthorizationPolicy";

export interface ProtectedIngressApplicationDependencies {
  credentials: IngressCredentialVerificationPort;
  appAttestation: AppAttestationVerificationPort;
  dispatcher: AuthorizedIngressDispatcherPort;
}

class DefaultProtectedIngressApplication implements ProtectedIngressInputPort {
  constructor(
    private readonly dependencies: ProtectedIngressApplicationDependencies,
  ) {}

  supportedPublicIngresses() {
    return supportedPublicIngresses();
  }

  async invoke(
    input: ProtectedIngressRequest,
  ): Promise<ProtectedIngressResult> {
    const authorization = input.authorization?.trim();
    if (!authorization) {
      return { kind: "unauthenticated", code: "AUTH_REQUIRED" };
    }
    const principal = await this.dependencies.credentials.verify(authorization);
    if (principal === undefined) {
      return { kind: "unauthenticated", code: "AUTH_REQUIRED" };
    }

    const attestation =
      input.appAttestation === undefined
        ? "missing"
        : (await this.dependencies.appAttestation.verify(input.appAttestation))
          ? "valid"
          : "invalid";
    const authorizationDecision = authorizePublicIngress({
      entryPoint: input.entryPoint,
      principal,
      appAttestation: attestation,
    });
    if (authorizationDecision.kind === "forbidden") {
      return authorizationDecision;
    }

    return this.dependencies.dispatcher.dispatch({
      entryPoint: input.entryPoint,
      principal,
      payload: input.payload,
    });
  }
}

export function createProtectedIngressApplication(
  dependencies: ProtectedIngressApplicationDependencies,
): ProtectedIngressInputPort {
  return new DefaultProtectedIngressApplication(dependencies);
}
