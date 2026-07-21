export type ProtectedIngress =
  | "RegisterEndpoint"
  | "RenameSelf"
  | "SubmitShortcutCapture"
  | "SaveDividendSnapshot";

export type IngressCapability =
  | "notifications:endpoint:register"
  | "household:self:rename"
  | "paymentCapture:submit";

export interface VerifiedIngressPrincipal {
  principalRef: string;
  capabilities: readonly IngressCapability[];
  activeMembership: boolean;
}

export interface ProtectedIngressRequest {
  entryPoint: ProtectedIngress;
  authorization?: string;
  appAttestation?: string;
  payload: Readonly<Record<string, unknown>>;
}

export type ProtectedIngressResult =
  | { kind: "unauthenticated"; code: "AUTH_REQUIRED" }
  | { kind: "forbidden"; code: string }
  | { kind: "success"; resourceId: string };

export interface PublicIngressRoute {
  entryPoint: Exclude<ProtectedIngress, "SaveDividendSnapshot">;
  requiredCapability: IngressCapability;
  requiresAppAttestation: boolean;
}
