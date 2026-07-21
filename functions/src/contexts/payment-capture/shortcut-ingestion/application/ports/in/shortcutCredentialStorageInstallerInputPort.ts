import type {
  ShortcutCredentialStorageAuthorizationResult,
  ShortcutCredentialStorageIssueResult,
  ShortcutCredentialStorageSession,
} from "../../../domain/model/shortcutCredentialStorageInstaller";

export interface ShortcutCredentialStorageInstallerInputPort<
  Endpoint extends string = string,
> {
  issue(input: {
    readonly session: ShortcutCredentialStorageSession;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
  }): Promise<ShortcutCredentialStorageIssueResult<Endpoint>>;

  reissue(input: {
    readonly session: ShortcutCredentialStorageSession;
    readonly currentCredentialId: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
  }): Promise<ShortcutCredentialStorageIssueResult<Endpoint>>;

  authorize(input: {
    readonly rawCredential: string;
    readonly requestedAt: string;
    readonly acceptedKeyVersions: readonly string[];
  }): Promise<ShortcutCredentialStorageAuthorizationResult>;

  logout(session: ShortcutCredentialStorageSession): void;
}
