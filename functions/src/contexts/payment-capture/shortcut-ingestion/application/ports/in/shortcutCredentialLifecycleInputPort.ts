import type {
  IssueShortcutCredentialResult,
  RevokeShortcutCredentialResult,
  ShortcutCredentialAuthorizationResult,
  ShortcutCredentialSession,
  ShortcutCredentialStatusResult,
} from "../../../domain/model/shortcutCredentialLifecycle";

export interface ShortcutCredentialLifecycleInputPort {
  issue(input: {
    readonly session: ShortcutCredentialSession;
    readonly requestedAt: string;
    readonly idempotencyKey: string;
    readonly issuanceMode?: "rotate" | "if-absent";
  }): Promise<IssueShortcutCredentialResult>;

  reissue(input: {
    readonly session: ShortcutCredentialSession;
    readonly currentCredentialId: string;
    readonly expectedVersion: number;
    readonly requestedAt: string;
    readonly idempotencyKey: string;
  }): Promise<IssueShortcutCredentialResult>;

  authorize(input: {
    readonly bearerCredential: string | null;
    readonly requestedAt: string;
    readonly acceptedKeyVersions?: readonly string[];
    readonly distinguishReplacement?: boolean;
  }): Promise<ShortcutCredentialAuthorizationResult>;

  getStatus(input: {
    readonly session: ShortcutCredentialSession;
  }): Promise<ShortcutCredentialStatusResult>;

  revoke(input: {
    readonly session: ShortcutCredentialSession;
    readonly credentialId: string;
    readonly expectedVersion: number;
    readonly requestedAt: string;
    readonly idempotencyKey: string;
  }): Promise<RevokeShortcutCredentialResult>;
}
