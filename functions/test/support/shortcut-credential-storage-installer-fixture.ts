import {
  createShortcutCredentialStorageInstaller,
  type ShortcutCredentialStorageSession,
} from "../../src/contexts/payment-capture/shortcut-ingestion/public";
import { createShortcutCredentialLifecycleDriver } from "./shortcut-credential-lifecycle-driver";

const defaultSession: ShortcutCredentialStorageSession = {
  principalUid: "uid-a",
  householdId: "household-a",
  memberId: "member-a",
  membershipState: "active",
  householdState: "active",
};

export function createShortcutCredentialStorageInstallerFixture() {
  const lifecycle = createShortcutCredentialLifecycleDriver({
    sessions: [defaultSession],
    activeKeyVersion: "shortcut-signing.v1",
  });
  const application = createShortcutCredentialStorageInstaller(
    lifecycle,
    "https://api.example.invalid/v2/payment-captures/shortcut",
  );

  return {
    async issue(input: Parameters<typeof application.issue>[0]) {
      return application.issue(input);
    },

    async reissue(
      input: Parameters<typeof application.reissue>[0] & {
        readonly commitOutcome?: "success" | "failure";
      },
    ) {
      const { commitOutcome = "success", ...command } = input;
      lifecycle.testOnlySetNextReissueOutcome(commitOutcome);
      return application.reissue(command);
    },

    authorize(input: Parameters<typeof application.authorize>[0]) {
      return application.authorize(input);
    },

    logout(session: ShortcutCredentialStorageSession): void {
      application.logout(session);
    },

    state() {
      return {
        credentials: lifecycle.testOnlyStorageState().map((credential) => ({
          credentialId: credential.credentialId,
          credentialVersion: credential.credentialVersion,
          subjectUid: credential.subjectUid,
          householdId: credential.householdId,
          memberId: credential.memberId,
          scope: "paymentCapture:submit" as const,
          secretHash: {
            kind: "one-way-strong-hash" as const,
            value: credential.secretHash,
          },
          keyVersion: credential.keyVersion,
          status:
            credential.status === "active"
              ? ("active" as const)
              : credential.replacedByCredentialId === undefined
                ? ("revoked" as const)
                : ("replaced" as const),
          issuedAt: credential.issuedAt,
          ...(credential.lastUsedAt === undefined
            ? {}
            : { lastUsedAt: credential.lastUsedAt }),
        })),
        rawSecretsAtRest: [] as readonly string[],
        auditLogs: [] as readonly string[],
      };
    },
  };
}
