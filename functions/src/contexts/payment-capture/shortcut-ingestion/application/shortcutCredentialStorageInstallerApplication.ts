import type { ShortcutCredentialLifecycleInputPort } from "./ports/in/shortcutCredentialLifecycleInputPort";
import type { ShortcutCredentialStorageInstallerInputPort } from "./ports/in/shortcutCredentialStorageInstallerInputPort";
import type {
  ShortcutCredentialStorageIssueResult,
  ShortcutInstallation,
} from "../domain/model/shortcutCredentialStorageInstaller";
import type { IssueShortcutCredentialResult } from "../domain/model/shortcutCredentialLifecycle";

export interface ShortcutCredentialStorageInstallerDependencies<
  Endpoint extends string = string,
> {
  readonly lifecycle: ShortcutCredentialLifecycleInputPort;
  readonly installation: ShortcutInstallation<Endpoint>;
}

function mapIssueResult<Endpoint extends string>(
  result: IssueShortcutCredentialResult,
  installation: ShortcutInstallation<Endpoint>,
): ShortcutCredentialStorageIssueResult<Endpoint> {
  switch (result.kind) {
    case "issued":
      return {
        kind: "Issued",
        credentialId: result.credentialId,
        credentialVersion: result.credentialVersion,
        rawCredential: result.rawCredential,
        install: installation,
      };
    case "alreadyIssued":
      return {
        kind: "AlreadyIssued",
        credentialId: result.credentialId,
        credentialVersion: result.credentialVersion,
      };
    case "forbidden":
      return { kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" };
    case "retryableFailure":
      return { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" };
  }
}

export function createShortcutCredentialStorageInstallerApplication<
  const Endpoint extends string,
>(
  dependencies: ShortcutCredentialStorageInstallerDependencies<Endpoint>,
): ShortcutCredentialStorageInstallerInputPort<Endpoint> {
  return {
    async issue(input) {
      return mapIssueResult(
        await dependencies.lifecycle.issue({
          ...input,
          issuanceMode: "if-absent",
        }),
        dependencies.installation,
      );
    },

    async reissue(input) {
      return mapIssueResult(
        await dependencies.lifecycle.reissue(input),
        dependencies.installation,
      );
    },

    async authorize(input) {
      const result = await dependencies.lifecycle.authorize({
        bearerCredential: input.rawCredential,
        requestedAt: input.requestedAt,
        acceptedKeyVersions: input.acceptedKeyVersions,
        distinguishReplacement: true,
      });
      if (result.kind === "authorized") {
        return {
          kind: "Authorized",
          actor: {
            householdId: result.actor.householdId,
            memberId: result.actor.actingMemberId,
          },
        };
      }
      if (result.kind === "forbidden") {
        return { kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" };
      }
      return { kind: "Unauthenticated", code: result.code };
    },

    logout(_session) {
      // PWA 세션 종료는 기기에 설치된 Shortcut credential의 명시적 폐기가 아닙니다.
    },
  };
}
