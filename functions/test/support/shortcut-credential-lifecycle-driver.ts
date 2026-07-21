import { createHash } from "node:crypto";

import { createShortcutCredentialLifecycleApplication } from "../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutCredentialLifecycleApplication";
import type {
  GeneratedShortcutCredentialSecret,
  ShortcutCredentialAccessPort,
  ShortcutCredentialRecordView,
  ShortcutCredentialSecretPort,
  ShortcutCredentialStorePort,
} from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutCredentialLifecyclePorts";
import type {
  IssueShortcutCredentialResult,
  RevokeShortcutCredentialResult,
  ShortcutCredentialAuthorizationResult,
  ShortcutCredentialLifecycleInputPort,
  ShortcutCredentialSession,
  ShortcutCredentialStatusResult,
} from "../../src/contexts/payment-capture/shortcut-ingestion/public";
import type {
  ShortcutCredentialRecord,
  ShortcutCredentialSubject,
} from "../../src/contexts/payment-capture/shortcut-ingestion/domain/model/shortcutCredentialLifecycle";

export interface ShortcutCredentialLifecycleDriverFixture {
  readonly sessions: readonly ShortcutCredentialSession[];
  readonly invitationCodes?: readonly {
    readonly rawCode: string;
    readonly householdId: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly status: "unused" | "used";
  }[];
  readonly issueOutcome?: "success" | "retryable-failure";
  readonly activeKeyVersion?: string;
  readonly credentials?: readonly {
    readonly testOnlyRawCredential: string;
    readonly credentialId: string;
    readonly credentialVersion: number;
    readonly subjectUid: string;
    readonly householdId: string;
    readonly memberId: string;
    readonly capabilities: readonly ["paymentCapture:submit"];
    readonly issuedAt: string;
    readonly keyVersion: string;
    readonly status: "active" | "revoked";
  }[];
}

export interface ShortcutCredentialLifecycleDriver
  extends ShortcutCredentialLifecycleInputPort {
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
  testOnlySetNextReissueOutcome(outcome: "success" | "failure"): void;
  testOnlyStorageState(): readonly ShortcutCredentialRecord[];
}

function subjectKey(subject: ShortcutCredentialSubject): string {
  return `${subject.subjectUid}\u0000${subject.householdId}\u0000${subject.memberId}`;
}

function sameSubject(
  record: ShortcutCredentialRecord,
  subject: ShortcutCredentialSubject,
): boolean {
  return (
    record.subjectUid === subject.subjectUid &&
    record.householdId === subject.householdId &&
    record.memberId === subject.memberId
  );
}

function secretHash(rawCredential: string): string {
  return createHash("sha256").update(rawCredential, "utf8").digest("hex");
}

function recordView(
  record: ShortcutCredentialRecord,
): ShortcutCredentialRecordView {
  const { secretHash: _secretHash, ...view } = record;
  return { ...view, capabilities: [...view.capabilities] };
}

class FixtureShortcutCredentialAccessPort
  implements ShortcutCredentialAccessPort
{
  constructor(private readonly sessions: readonly ShortcutCredentialSession[]) {}

  async resolveSession(session: ShortcutCredentialSession) {
    const canonical = this.sessions.find(
      (candidate) =>
        candidate.principalUid === session.principalUid &&
        candidate.householdId === session.householdId &&
        candidate.memberId === session.memberId,
    );
    return canonical !== undefined &&
      session.membershipState === "active" &&
      session.householdState === "active" &&
      canonical.membershipState === "active" &&
      canonical.householdState === "active"
      ? {
          kind: "active" as const,
          subject: {
            subjectUid: canonical.principalUid,
            householdId: canonical.householdId,
            memberId: canonical.memberId,
          },
        }
      : { kind: "forbidden" as const };
  }

  async resolveClaims(subject: ShortcutCredentialSubject) {
    const canonical = this.sessions.find(
      (session) =>
        session.principalUid === subject.subjectUid &&
        session.householdId === subject.householdId &&
        session.memberId === subject.memberId,
    );
    return canonical !== undefined &&
      canonical.membershipState === "active" &&
      canonical.householdState === "active"
      ? { kind: "active" as const }
      : { kind: "forbidden" as const };
  }
}

class FixtureShortcutCredentialSecretPort
  implements ShortcutCredentialSecretPort
{
  private nextId = 1;

  constructor(private readonly keyVersion: string) {}

  generate(): GeneratedShortcutCredentialSecret {
    const credentialId = `credential-generated-${this.nextId++}`;
    const rawCredential = `shortcut.v1.${credentialId}.test-secret`;
    return {
      credentialId,
      rawCredential,
      secretHash: secretHash(rawCredential),
    };
  }

  hash(rawCredential: string): string {
    return secretHash(rawCredential);
  }

  activeKeyVersion(): string {
    return this.keyVersion;
  }

  installUrl(): string {
    return "https://www.icloud.com/shortcuts/household-account-payment";
  }
}

class InMemoryShortcutCredentialStore implements ShortcutCredentialStorePort {
  private readonly records = new Map<string, ShortcutCredentialRecord>();
  private readonly issueReceipts = new Map<
    string,
    {
      readonly credentialId: string;
      readonly credentialVersion: number;
    }
  >();
  private readonly revokeReceipts = new Map<
    string,
    RevokeShortcutCredentialResult
  >();

  constructor(
    fixture: ShortcutCredentialLifecycleDriverFixture,
  ) {
    this.issueAvailable = fixture.issueOutcome !== "retryable-failure";
    for (const credential of fixture.credentials ?? []) {
      this.records.set(credential.credentialId, {
        credentialId: credential.credentialId,
        credentialVersion: credential.credentialVersion,
        subjectUid: credential.subjectUid,
        householdId: credential.householdId,
        memberId: credential.memberId,
        capabilities: ["paymentCapture:submit"],
        issuedAt: credential.issuedAt,
        keyVersion: credential.keyVersion,
        secretHash: secretHash(credential.testOnlyRawCredential),
        status: credential.status,
      });
    }
  }

  private readonly issueAvailable: boolean;
  private nextReissueOutcome: "success" | "failure" = "success";

  setNextReissueOutcome(outcome: "success" | "failure"): void {
    this.nextReissueOutcome = outcome;
  }

  storageState(): readonly ShortcutCredentialRecord[] {
    return [...this.records.values()]
      .sort((left, right) =>
        left.issuedAt === right.issuedAt
          ? left.credentialVersion - right.credentialVersion
          : left.issuedAt.localeCompare(right.issuedAt),
      )
      .map((record) => ({
        ...record,
        capabilities: [...record.capabilities],
      }));
  }

  private latestActiveForSubject(
    subject: ShortcutCredentialSubject,
  ): ShortcutCredentialRecord | undefined {
    return [...this.records.values()]
      .filter(
        (record) => sameSubject(record, subject) && record.status === "active",
      )
      .sort((left, right) =>
        right.issuedAt === left.issuedAt
          ? right.credentialVersion - left.credentialVersion
          : right.issuedAt.localeCompare(left.issuedAt),
      )[0];
  }

  private receiptKey(
    subject: ShortcutCredentialSubject,
    idempotencyKey: string,
  ): string {
    return `${subjectKey(subject)}\u0000${idempotencyKey}`;
  }

  private replaceActiveCredential(input: {
    readonly subject: ShortcutCredentialSubject;
    readonly requestedAt: string;
    readonly credentialId: string;
    readonly secretHash: string;
    readonly keyVersion: string;
  }): {
    readonly kind: "issued";
    readonly credentialId: string;
    readonly credentialVersion: number;
  } {
    const subjectRecords = [...this.records.values()].filter((record) =>
      sameSubject(record, input.subject),
    );
    const credentialVersion =
      Math.max(0, ...subjectRecords.map((record) => record.credentialVersion)) + 1;
    const replacement: ShortcutCredentialRecord = {
      credentialId: input.credentialId,
      credentialVersion,
      subjectUid: input.subject.subjectUid,
      householdId: input.subject.householdId,
      memberId: input.subject.memberId,
      capabilities: ["paymentCapture:submit"],
      issuedAt: input.requestedAt,
      keyVersion: input.keyVersion,
      secretHash: input.secretHash,
      status: "active",
    };

    for (const record of subjectRecords) {
      if (record.status !== "active") continue;
      this.records.set(record.credentialId, {
        ...record,
        credentialVersion: record.credentialVersion + 1,
        status: "revoked",
        revokedAt: input.requestedAt,
        replacedByCredentialId: replacement.credentialId,
      });
    }
    this.records.set(replacement.credentialId, replacement);
    return {
      kind: "issued",
      credentialId: replacement.credentialId,
      credentialVersion,
    };
  }

  async issueAndRotate(
    input: Parameters<ShortcutCredentialStorePort["issueAndRotate"]>[0],
  ): ReturnType<ShortcutCredentialStorePort["issueAndRotate"]> {
    const receiptKey = this.receiptKey(input.subject, input.idempotencyKey);
    const existingReceipt = this.issueReceipts.get(receiptKey);
    if (existingReceipt !== undefined) {
      return { kind: "already-issued", ...existingReceipt };
    }
    const active = this.latestActiveForSubject(input.subject);
    if (input.issuanceMode === "if-absent" && active !== undefined) {
      const receipt = {
        credentialId: active.credentialId,
        credentialVersion: active.credentialVersion,
      };
      this.issueReceipts.set(receiptKey, receipt);
      return { kind: "already-issued", ...receipt };
    }
    if (!this.issueAvailable) return { kind: "unavailable" };

    const replacement = this.replaceActiveCredential(input);
    this.issueReceipts.set(receiptKey, {
      credentialId: replacement.credentialId,
      credentialVersion: replacement.credentialVersion,
    });
    return replacement;
  }

  async reissueAndRotate(
    input: Parameters<ShortcutCredentialStorePort["reissueAndRotate"]>[0],
  ): ReturnType<ShortcutCredentialStorePort["reissueAndRotate"]> {
    const receiptKey = this.receiptKey(input.subject, input.idempotencyKey);
    const existingReceipt = this.issueReceipts.get(receiptKey);
    if (existingReceipt !== undefined) {
      return { kind: "already-issued", ...existingReceipt };
    }

    const requestedCurrent = this.records.get(input.currentCredentialId);
    const currentMatches =
      requestedCurrent !== undefined &&
      sameSubject(requestedCurrent, input.subject) &&
      requestedCurrent.status === "active" &&
      requestedCurrent.credentialVersion === input.expectedVersion;
    if (!currentMatches) {
      const active = this.latestActiveForSubject(input.subject);
      const convergence = active ?? requestedCurrent;
      if (convergence === undefined || !sameSubject(convergence, input.subject)) {
        return { kind: "unavailable" };
      }
      const receipt = {
        credentialId: convergence.credentialId,
        credentialVersion: convergence.credentialVersion,
      };
      this.issueReceipts.set(receiptKey, receipt);
      return { kind: "already-issued", ...receipt };
    }

    const commitFails =
      !this.issueAvailable || this.nextReissueOutcome === "failure";
    this.nextReissueOutcome = "success";
    if (commitFails) return { kind: "unavailable" };

    const replacement = this.replaceActiveCredential(input);
    this.issueReceipts.set(receiptKey, {
      credentialId: replacement.credentialId,
      credentialVersion: replacement.credentialVersion,
    });
    return replacement;
  }

  async findBySecretHash(hash: string): Promise<ShortcutCredentialRecordView | undefined> {
    const record = [...this.records.values()].find(
      (candidate) => candidate.secretHash === hash,
    );
    return record === undefined ? undefined : recordView(record);
  }

  async findLatestForSubject(
    subject: ShortcutCredentialSubject,
  ): Promise<ShortcutCredentialRecordView | undefined> {
    const record = [...this.records.values()]
      .filter((candidate) => sameSubject(candidate, subject))
      .sort((left, right) =>
        right.issuedAt === left.issuedAt
          ? right.credentialVersion - left.credentialVersion
          : right.issuedAt.localeCompare(left.issuedAt),
      )[0];
    return record === undefined ? undefined : recordView(record);
  }

  async markUsed(input: { credentialId: string; householdId: string; requestedAt: string }): Promise<void> {
    const record = this.records.get(input.credentialId);
    if (record === undefined) return;
    this.records.set(input.credentialId, {
      ...record,
      lastUsedAt: input.requestedAt,
    });
  }

  async revokeOwned(
    input: Parameters<ShortcutCredentialStorePort["revokeOwned"]>[0],
  ): Promise<RevokeShortcutCredentialResult> {
    const receiptKey = `${subjectKey(input.subject)}\u0000${input.idempotencyKey}`;
    const receipt = this.revokeReceipts.get(receiptKey);
    if (receipt !== undefined) return { ...receipt };

    const record = this.records.get(input.credentialId);
    if (record === undefined) return { kind: "notFound" };
    if (!sameSubject(record, input.subject)) {
      return { kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" };
    }
    if (record.status === "revoked") {
      return { kind: "alreadyRevoked", credentialId: record.credentialId };
    }
    if (record.credentialVersion !== input.expectedVersion) {
      return { kind: "conflict", code: "CREDENTIAL_VERSION_MISMATCH" };
    }

    const result = {
      kind: "revoked" as const,
      credentialId: record.credentialId,
      credentialVersion: record.credentialVersion + 1,
    };
    this.records.set(record.credentialId, {
      ...record,
      credentialVersion: result.credentialVersion,
      status: "revoked",
      revokedAt: input.requestedAt,
    });
    this.revokeReceipts.set(receiptKey, result);
    return result;
  }

}

export function createShortcutCredentialLifecycleDriver(
  fixture: ShortcutCredentialLifecycleDriverFixture,
): ShortcutCredentialLifecycleDriver {
  const store = new InMemoryShortcutCredentialStore(fixture);
  const application = createShortcutCredentialLifecycleApplication({
    access: new FixtureShortcutCredentialAccessPort(fixture.sessions),
    secrets: new FixtureShortcutCredentialSecretPort(
      fixture.activeKeyVersion ?? "signing-key-v1",
    ),
    store,
  });
  return {
    ...application,
    testOnlySetNextReissueOutcome(outcome) {
      store.setNextReissueOutcome(outcome);
    },
    testOnlyStorageState() {
      return store.storageState();
    },
  };
}
