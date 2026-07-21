import type {
  CredentialIngressInputPort,
  IngressCredential,
  VerifiedIngressContext,
} from "./ports/in/credentialIngressInputPort";
import type {
  CredentialIngressQuotaPort,
  CredentialIngressReceiptPort,
} from "./ports/out/credentialIngressPorts";

function principalId(credential: IngressCredential): string {
  return credential.kind === "service-account"
    ? credential.serviceIdentity
    : credential.actorId;
}

export function createCredentialIngressApplication(dependencies: {
  readonly allowedOrigins: readonly string[];
  readonly supportedAppIds: readonly string[];
  readonly quota: CredentialIngressQuotaPort;
  readonly receipts: CredentialIngressReceiptPort;
}): CredentialIngressInputPort {
  return {
    async invoke(request) {
      if (
        request.route === "supported-app-refresh" &&
        (request.origin === undefined || !dependencies.allowedOrigins.includes(request.origin))
      ) {
        return { kind: "rejected", code: "CORS_ORIGIN_REJECTED" };
      }
      const credential = request.credential;
      if (credential === undefined) return { kind: "rejected", code: "AUTH_REQUIRED" };
      if (Date.parse(credential.expiresAt) <= Date.parse(request.requestedAt)) {
        return { kind: "rejected", code: "CREDENTIAL_EXPIRED" };
      }
      if (credential.kind !== "user-id-token" && credential.revoked) {
        return { kind: "rejected", code: "CREDENTIAL_REVOKED" };
      }
      if (credential.kind === "user-id-token" && credential.actorLifecycle !== "active") {
        return { kind: "rejected", code: "ACTOR_INACTIVE" };
      }

      const credentialHousehold =
        credential.kind === "service-account" ? request.householdId : credential.householdId;
      if (credentialHousehold !== request.householdId) {
        return { kind: "rejected", code: "HOUSEHOLD_SCOPE_MISMATCH" };
      }

      if (request.route === "supported-app-refresh") {
        if (
          credential.kind !== "user-id-token" ||
          request.appCheck?.valid !== true ||
          !dependencies.supportedAppIds.includes(request.appCheck.appId)
        ) {
          return { kind: "rejected", code: "APP_CHECK_REJECTED" };
        }
      } else if (
        credential.kind === "user-id-token" ||
        !credential.scopes.includes("market.refresh")
      ) {
        return { kind: "rejected", code: "CREDENTIAL_SCOPE_MISSING" };
      }

      if (!(await dependencies.quota.credentialAvailable(credential.credentialId))) {
        return { kind: "rejected", code: "CREDENTIAL_RATE_LIMITED" };
      }
      if (!(await dependencies.quota.sourceIpAvailable(request.sourceIp))) {
        return { kind: "rejected", code: "IP_RATE_LIMITED" };
      }

      const context: VerifiedIngressContext = {
        principalKind: credential.kind,
        principalId: principalId(credential),
        householdId: request.householdId,
        grantedScope: "market.refresh",
      };
      const applicationReceiptId = dependencies.receipts.nextId();
      await dependencies.receipts.save({ receiptId: applicationReceiptId, context });
      return { kind: "accepted", context, applicationReceiptId };
    },
  };
}
