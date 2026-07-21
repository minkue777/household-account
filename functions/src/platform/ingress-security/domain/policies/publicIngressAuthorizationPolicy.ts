import type {
  ProtectedIngress,
  PublicIngressRoute,
  VerifiedIngressPrincipal,
} from "../model/protectedIngress";

const PUBLIC_INGRESS_ROUTES: readonly PublicIngressRoute[] = [
  {
    entryPoint: "RegisterEndpoint",
    requiredCapability: "notifications:endpoint:register",
    requiresAppAttestation: true,
  },
  {
    entryPoint: "RenameSelf",
    requiredCapability: "household:self:rename",
    requiresAppAttestation: true,
  },
  {
    entryPoint: "SubmitShortcutCapture",
    requiredCapability: "paymentCapture:submit",
    requiresAppAttestation: false,
  },
] as const;

export function supportedPublicIngresses(): readonly PublicIngressRoute["entryPoint"][] {
  return PUBLIC_INGRESS_ROUTES.map((route) => route.entryPoint);
}

export function findPublicIngressRoute(
  entryPoint: ProtectedIngress,
): PublicIngressRoute | undefined {
  return PUBLIC_INGRESS_ROUTES.find(
    (route) => route.entryPoint === entryPoint,
  );
}

export type PublicIngressAuthorizationDecision =
  | { kind: "allowed"; route: PublicIngressRoute }
  | {
      kind: "forbidden";
      code:
        | "INGRESS_NOT_ALLOWED"
        | "ACTIVE_MEMBERSHIP_REQUIRED"
        | "CAPABILITY_REQUIRED"
        | "APP_ATTESTATION_REQUIRED"
        | "APP_ATTESTATION_INVALID";
    };

export function authorizePublicIngress(input: {
  entryPoint: ProtectedIngress;
  principal: VerifiedIngressPrincipal;
  appAttestation: "valid" | "invalid" | "missing";
}): PublicIngressAuthorizationDecision {
  const route = findPublicIngressRoute(input.entryPoint);
  if (route === undefined) {
    return { kind: "forbidden", code: "INGRESS_NOT_ALLOWED" };
  }
  if (!input.principal.activeMembership) {
    return { kind: "forbidden", code: "ACTIVE_MEMBERSHIP_REQUIRED" };
  }
  if (!input.principal.capabilities.includes(route.requiredCapability)) {
    return { kind: "forbidden", code: "CAPABILITY_REQUIRED" };
  }
  if (route.requiresAppAttestation && input.appAttestation === "missing") {
    return { kind: "forbidden", code: "APP_ATTESTATION_REQUIRED" };
  }
  if (route.requiresAppAttestation && input.appAttestation === "invalid") {
    return { kind: "forbidden", code: "APP_ATTESTATION_INVALID" };
  }
  return { kind: "allowed", route };
}
