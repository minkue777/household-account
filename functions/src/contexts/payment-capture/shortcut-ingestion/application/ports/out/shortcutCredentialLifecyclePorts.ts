import type {
  RevokeShortcutCredentialResult,
  ShortcutCredentialRecord,
  ShortcutCredentialSession,
  ShortcutCredentialSubject,
} from "../../../domain/model/shortcutCredentialLifecycle";

export type ShortcutCredentialRecordView = Omit<
  ShortcutCredentialRecord,
  "secretHash"
>;

export interface ShortcutCredentialAccessPort {
  resolveSession(
    session: ShortcutCredentialSession,
  ): Promise<
    | { readonly kind: "active"; readonly subject: ShortcutCredentialSubject }
    | { readonly kind: "forbidden" }
  >;

  resolveClaims(
    subject: ShortcutCredentialSubject,
  ): Promise<{ readonly kind: "active" } | { readonly kind: "forbidden" }>;
}

export interface GeneratedShortcutCredentialSecret {
  readonly credentialId: string;
  readonly rawCredential: string;
  readonly secretHash: string;
}

export interface ShortcutCredentialSecretPort {
  generate(): GeneratedShortcutCredentialSecret;
  hash(rawCredential: string): string;
  activeKeyVersion(): string;
  installUrl(): string;
}

export type IssueShortcutCredentialCommitResult =
  | {
      readonly kind: "issued";
      readonly credentialId: string;
      readonly credentialVersion: number;
    }
  | {
      readonly kind: "already-issued";
      readonly credentialId: string;
      readonly credentialVersion: number;
    }
  | { readonly kind: "unavailable" };

export interface ShortcutCredentialStorePort {
  issueAndRotate(input: {
    readonly subject: ShortcutCredentialSubject;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly credentialId: string;
    readonly secretHash: string;
    readonly keyVersion: string;
    readonly issuanceMode?: "rotate" | "if-absent";
  }): Promise<IssueShortcutCredentialCommitResult>;

  reissueAndRotate(input: {
    readonly subject: ShortcutCredentialSubject;
    readonly currentCredentialId: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly credentialId: string;
    readonly secretHash: string;
    readonly keyVersion: string;
  }): Promise<IssueShortcutCredentialCommitResult>;

  findBySecretHash(
    secretHash: string,
  ): Promise<ShortcutCredentialRecordView | undefined>;
  findLatestForSubject(
    subject: ShortcutCredentialSubject,
  ): Promise<ShortcutCredentialRecordView | undefined>;
  markUsed(input: {
    readonly credentialId: string;
    readonly householdId: string;
    readonly requestedAt: string;
  }): Promise<void>;
  revokeOwned(input: {
    readonly subject: ShortcutCredentialSubject;
    readonly credentialId: string;
    readonly expectedVersion: number;
    readonly requestedAt: string;
    readonly idempotencyKey: string;
  }): Promise<RevokeShortcutCredentialResult>;
}
