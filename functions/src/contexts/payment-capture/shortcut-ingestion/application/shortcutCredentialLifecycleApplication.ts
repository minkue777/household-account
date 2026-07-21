import type { ShortcutCredentialLifecycleInputPort } from "./ports/in/shortcutCredentialLifecycleInputPort";
import type {
  ShortcutCredentialAccessPort,
  ShortcutCredentialSecretPort,
  ShortcutCredentialStorePort,
} from "./ports/out/shortcutCredentialLifecyclePorts";
import { recordSubject } from "../domain/policies/shortcutCredentialAccess";

export interface ShortcutCredentialLifecycleDependencies {
  readonly access: ShortcutCredentialAccessPort;
  readonly secrets: ShortcutCredentialSecretPort;
  readonly store: ShortcutCredentialStorePort;
}

export function createShortcutCredentialLifecycleApplication(
  dependencies: ShortcutCredentialLifecycleDependencies,
): ShortcutCredentialLifecycleInputPort {
  function issueFromCommit(
    generated: ReturnType<ShortcutCredentialSecretPort["generate"]>,
    installUrl: string,
    requestedAt: string,
    committed: Awaited<ReturnType<ShortcutCredentialStorePort["issueAndRotate"]>>,
  ) {
    if (committed.kind === "unavailable") {
      return {
        kind: "retryableFailure" as const,
        code: "CREDENTIAL_COMMIT_UNAVAILABLE",
      };
    }
    if (committed.kind === "already-issued") {
      return {
        kind: "alreadyIssued" as const,
        credentialId: committed.credentialId,
        credentialVersion: committed.credentialVersion,
      };
    }

    return {
      kind: "issued" as const,
      credentialId: committed.credentialId,
      credentialVersion: committed.credentialVersion,
      rawCredential: generated.rawCredential,
      installUrl,
      issuedAt: requestedAt,
    };
  }

  return {
    async issue(input) {
      const access = await dependencies.access.resolveSession(input.session);
      if (access.kind === "forbidden") {
        return { kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" };
      }

      const installUrl = dependencies.secrets.installUrl();
      const generated = dependencies.secrets.generate();
      const committed = await dependencies.store.issueAndRotate({
        subject: access.subject,
        idempotencyKey: input.idempotencyKey,
        requestedAt: input.requestedAt,
        credentialId: generated.credentialId,
        secretHash: generated.secretHash,
        keyVersion: dependencies.secrets.activeKeyVersion(),
        ...(input.issuanceMode === undefined
          ? {}
          : { issuanceMode: input.issuanceMode }),
      });
      return issueFromCommit(generated, installUrl, input.requestedAt, committed);
    },

    async reissue(input) {
      const access = await dependencies.access.resolveSession(input.session);
      if (access.kind === "forbidden") {
        return { kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" };
      }

      const installUrl = dependencies.secrets.installUrl();
      const generated = dependencies.secrets.generate();
      const committed = await dependencies.store.reissueAndRotate({
        subject: access.subject,
        currentCredentialId: input.currentCredentialId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        requestedAt: input.requestedAt,
        credentialId: generated.credentialId,
        secretHash: generated.secretHash,
        keyVersion: dependencies.secrets.activeKeyVersion(),
      });
      return issueFromCommit(generated, installUrl, input.requestedAt, committed);
    },

    async authorize(input) {
      if (input.bearerCredential === null || input.bearerCredential === "") {
        return {
          kind: "unauthenticated",
          httpStatus: 401,
          code: "AUTH_REQUIRED",
        };
      }

      const credential = await dependencies.store.findBySecretHash(
        dependencies.secrets.hash(input.bearerCredential),
      );
      if (credential === undefined) {
        return {
          kind: "unauthenticated",
          httpStatus: 401,
          code: "AUTH_REQUIRED",
        };
      }
      if (credential.status === "revoked") {
        return {
          kind: "unauthenticated",
          httpStatus: 401,
          code:
            input.distinguishReplacement === true &&
            credential.replacedByCredentialId !== undefined
              ? "CREDENTIAL_REPLACED"
              : "CREDENTIAL_REVOKED",
        };
      }
      const acceptedKeyVersions =
        input.acceptedKeyVersions ?? [dependencies.secrets.activeKeyVersion()];
      if (!acceptedKeyVersions.includes(credential.keyVersion)) {
        return {
          kind: "unauthenticated",
          httpStatus: 401,
          code: "CREDENTIAL_KEY_VERSION_INVALID",
        };
      }

      const subject = recordSubject(credential);
      if ((await dependencies.access.resolveClaims(subject)).kind === "forbidden") {
        return {
          kind: "forbidden",
          httpStatus: 403,
          code: "HOUSEHOLD_FORBIDDEN",
        };
      }

      await dependencies.store.markUsed({
        credentialId: credential.credentialId,
        householdId: credential.householdId,
        requestedAt: input.requestedAt,
      });
      return {
        kind: "authorized",
        actor: {
          principalUid: credential.subjectUid,
          householdId: credential.householdId,
          actingMemberId: credential.memberId,
          capabilities: ["paymentCapture:submit"],
        },
      };
    },

    async getStatus(input) {
      const access = await dependencies.access.resolveSession(input.session);
      if (access.kind === "forbidden") {
        return { kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" };
      }
      const credential = await dependencies.store.findLatestForSubject(
        access.subject,
      );
      if (credential === undefined) return { kind: "notFound" };

      return {
        kind: "found",
        credential: {
          credentialId: credential.credentialId,
          credentialVersion: credential.credentialVersion,
          status: credential.status,
          masked: true,
          issuedAt: credential.issuedAt,
          ...(credential.lastUsedAt === undefined
            ? {}
            : { lastUsedAt: credential.lastUsedAt }),
        },
      };
    },

    async revoke(input) {
      const access = await dependencies.access.resolveSession(input.session);
      if (access.kind === "forbidden") {
        return { kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" };
      }
      return dependencies.store.revokeOwned({
        subject: access.subject,
        credentialId: input.credentialId,
        expectedVersion: input.expectedVersion,
        requestedAt: input.requestedAt,
        idempotencyKey: input.idempotencyKey,
      });
    },
  };
}
