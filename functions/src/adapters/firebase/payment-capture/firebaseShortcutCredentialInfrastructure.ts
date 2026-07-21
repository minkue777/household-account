import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  ShortcutCredentialAccessPort,
  ShortcutCredentialRecordView,
  ShortcutCredentialSecretPort,
  ShortcutCredentialStorePort,
} from "../../../contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutCredentialLifecyclePorts";
import type {
  RevokeShortcutCredentialResult,
  ShortcutCredentialSession,
  ShortcutCredentialSubject,
} from "../../../contexts/payment-capture/shortcut-ingestion/domain/model/shortcutCredentialLifecycle";

const HOUSEHOLDS = "households";
const CREDENTIALS = "shortcutCredentials";
const SUBJECTS = "shortcutCredentialSubjects";
const CAPABILITY = "paymentCapture:submit" as const;
const RAW_PREFIX = "hca-shortcut.v1";

function text(
  data: FirebaseFirestore.DocumentData | undefined,
  field: string,
): string | undefined {
  const value = data?.[field];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function integer(
  data: FirebaseFirestore.DocumentData | undefined,
  field: string,
): number | undefined {
  const value = data?.[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function subjectDocumentId(subject: ShortcutCredentialSubject): string {
  return createHash("sha256")
    .update(
      `${subject.subjectUid}\u0000${subject.householdId}\u0000${subject.memberId}`,
      "utf8",
    )
    .digest("hex");
}

function operationReceiptId(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey, "utf8").digest("hex");
}

function sameSubject(
  record: ShortcutCredentialRecordView,
  subject: ShortcutCredentialSubject,
): boolean {
  return (
    record.subjectUid === subject.subjectUid &&
    record.householdId === subject.householdId &&
    record.memberId === subject.memberId
  );
}

function credentialView(
  id: string,
  data: FirebaseFirestore.DocumentData | undefined,
): ShortcutCredentialRecordView | undefined {
  const credentialVersion = integer(data, "credentialVersion");
  const subjectUid = text(data, "subjectUid");
  const householdId = text(data, "householdId");
  const memberId = text(data, "memberId");
  const issuedAt = text(data, "issuedAt");
  const keyVersion = text(data, "keyVersion");
  const status = data?.status;
  const capabilities = data?.capabilities;
  if (
    credentialVersion === undefined ||
    subjectUid === undefined ||
    householdId === undefined ||
    memberId === undefined ||
    issuedAt === undefined ||
    keyVersion === undefined ||
    !Array.isArray(capabilities) ||
    capabilities.length !== 1 ||
    capabilities[0] !== CAPABILITY ||
    (status !== "active" && status !== "revoked")
  ) {
    return undefined;
  }
  return {
    credentialId: id,
    credentialVersion,
    subjectUid,
    householdId,
    memberId,
    capabilities: [CAPABILITY],
    issuedAt,
    keyVersion,
    status,
    ...(text(data, "lastUsedAt") === undefined
      ? {}
      : { lastUsedAt: text(data, "lastUsedAt") }),
    ...(text(data, "revokedAt") === undefined
      ? {}
      : { revokedAt: text(data, "revokedAt") }),
    ...(text(data, "replacedByCredentialId") === undefined
      ? {}
      : {
          replacedByCredentialId: text(data, "replacedByCredentialId"),
        }),
  };
}

async function canonicalSubjectIsActive(
  database: firestore.Firestore,
  subject: ShortcutCredentialSubject,
): Promise<boolean> {
  const household = database.collection(HOUSEHOLDS).doc(subject.householdId);
  const [householdSnapshot, membershipSnapshot, memberSnapshot] =
    await Promise.all([
      household.get(),
      household.collection("memberships").doc(subject.subjectUid).get(),
      household.collection("members").doc(subject.memberId).get(),
    ]);
  if (!householdSnapshot.exists || !membershipSnapshot.exists) return false;
  const householdData = householdSnapshot.data();
  const membership = membershipSnapshot.data();
  const householdState = text(householdData, "lifecycleState") ?? "active";
  const membershipState =
    text(membership, "lifecycleState") ?? text(membership, "status") ?? "active";
  return (
    householdState === "active" &&
    householdData?.deletedAt === undefined &&
    membershipState === "active" &&
    text(membership, "householdId") === subject.householdId &&
    text(membership, "memberId") === subject.memberId &&
    memberSnapshot.exists &&
    memberSnapshot.data()?.deletedAt === undefined &&
    (text(memberSnapshot.data(), "lifecycleState") ?? "active") === "active"
  );
}

export class FirebaseShortcutCredentialAccessAdapter
  implements ShortcutCredentialAccessPort
{
  constructor(private readonly database: firestore.Firestore) {}

  async resolveSession(session: ShortcutCredentialSession) {
    if (
      session.membershipState !== "active" ||
      session.householdState !== "active"
    ) {
      return { kind: "forbidden" as const };
    }
    const subject: ShortcutCredentialSubject = {
      subjectUid: session.principalUid,
      householdId: session.householdId,
      memberId: session.memberId,
    };
    return (await canonicalSubjectIsActive(this.database, subject))
      ? { kind: "active" as const, subject }
      : { kind: "forbidden" as const };
  }

  async resolveClaims(subject: ShortcutCredentialSubject) {
    return (await canonicalSubjectIsActive(this.database, subject))
      ? { kind: "active" as const }
      : { kind: "forbidden" as const };
  }
}

export interface ShortcutCredentialSecretConfiguration {
  readonly pepper: () => string | undefined;
  readonly keyVersion: () => string | undefined;
  readonly installUrl: () => string | undefined;
}

export class HmacShortcutCredentialSecretAdapter
  implements ShortcutCredentialSecretPort
{
  constructor(private readonly configuration: ShortcutCredentialSecretConfiguration) {}

  private configuredPepper(): string {
    const value = this.configuration.pepper();
    if (value === undefined || Buffer.byteLength(value, "utf8") < 32) {
      throw new Error("SHORTCUT_CREDENTIAL_PEPPER_NOT_CONFIGURED");
    }
    return value;
  }

  generate() {
    const credentialId = randomUUID();
    const rawCredential = `${RAW_PREFIX}.${credentialId}.${randomBytes(32).toString("base64url")}`;
    return {
      credentialId,
      rawCredential,
      secretHash: this.hash(rawCredential),
    };
  }

  hash(rawCredential: string): string {
    return `hmac-sha256:${createHmac("sha256", this.configuredPepper())
      .update(rawCredential, "utf8")
      .digest("hex")}`;
  }

  activeKeyVersion(): string {
    const value = this.configuration.keyVersion()?.trim();
    return value === undefined || value === "" ? "shortcut-hmac.v1" : value;
  }

  installUrl(): string {
    const value = this.configuration.installUrl()?.trim();
    if (value === undefined || !/^https:\/\/www\.icloud\.com\/shortcuts\//u.test(value)) {
      throw new Error("SHORTCUT_INSTALL_URL_NOT_CONFIGURED");
    }
    return value;
  }

  static credentialId(rawCredential: string): string | undefined {
    const match = rawCredential.match(
      /^hca-shortcut\.v1\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[A-Za-z0-9_-]{32,}$/iu,
    );
    return match?.[1]?.toLowerCase();
  }
}

interface SubjectPointer {
  readonly credentialId?: unknown;
  readonly credentialVersion?: unknown;
  readonly status?: unknown;
}

export class FirebaseShortcutCredentialStoreAdapter
  implements ShortcutCredentialStorePort
{
  constructor(private readonly database: firestore.Firestore) {}

  private household(subject: ShortcutCredentialSubject) {
    return this.database.collection(HOUSEHOLDS).doc(subject.householdId);
  }

  private subject(subject: ShortcutCredentialSubject) {
    return this.household(subject)
      .collection(SUBJECTS)
      .doc(subjectDocumentId(subject));
  }

  async issueAndRotate(
    input: Parameters<ShortcutCredentialStorePort["issueAndRotate"]>[0],
  ) {
    const subject = this.subject(input.subject);
    const receipt = subject
      .collection("operationReceipts")
      .doc(operationReceiptId(input.idempotencyKey));
    try {
      return await this.database.runTransaction(async (transaction) => {
        const [receiptSnapshot, pointerSnapshot] = await Promise.all([
          transaction.get(receipt),
          transaction.get(subject),
        ]);
        if (receiptSnapshot.exists) {
          const data = receiptSnapshot.data();
          const credentialId = text(data, "credentialId");
          const credentialVersion = integer(data, "credentialVersion");
          return credentialId !== undefined && credentialVersion !== undefined
            ? ({ kind: "already-issued", credentialId, credentialVersion } as const)
            : ({ kind: "unavailable" } as const);
        }

        const pointer = pointerSnapshot.data() as SubjectPointer | undefined;
        const activeCredentialId =
          pointer?.status === "active" && typeof pointer.credentialId === "string"
            ? pointer.credentialId
            : undefined;
        const activeVersion =
          typeof pointer?.credentialVersion === "number" &&
          Number.isSafeInteger(pointer.credentialVersion)
            ? pointer.credentialVersion
            : 0;
        if (input.issuanceMode === "if-absent" && activeCredentialId !== undefined) {
          transaction.create(receipt, {
            operation: "issue",
            credentialId: activeCredentialId,
            credentialVersion: activeVersion,
            requestedAt: input.requestedAt,
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "already-issued" as const,
            credentialId: activeCredentialId,
            credentialVersion: activeVersion,
          };
        }

        const credentialVersion = activeVersion + 1;
        if (activeCredentialId !== undefined) {
          transaction.set(
            this.household(input.subject)
              .collection(CREDENTIALS)
              .doc(activeCredentialId),
            {
              status: "revoked",
              revokedAt: input.requestedAt,
              replacedByCredentialId: input.credentialId,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
        const credential = this.household(input.subject)
          .collection(CREDENTIALS)
          .doc(input.credentialId);
        transaction.create(credential, {
          credentialId: input.credentialId,
          credentialVersion,
          subjectUid: input.subject.subjectUid,
          householdId: input.subject.householdId,
          memberId: input.subject.memberId,
          capabilities: [CAPABILITY],
          issuedAt: input.requestedAt,
          keyVersion: input.keyVersion,
          secretHash: input.secretHash,
          status: "active",
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(subject, {
          ...input.subject,
          credentialId: input.credentialId,
          credentialVersion,
          status: "active",
          updatedAt: FieldValue.serverTimestamp(),
          schemaVersion: 1,
        });
        transaction.create(receipt, {
          operation: "issue",
          credentialId: input.credentialId,
          credentialVersion,
          requestedAt: input.requestedAt,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        return {
          kind: "issued" as const,
          credentialId: input.credentialId,
          credentialVersion,
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async reissueAndRotate(
    input: Parameters<ShortcutCredentialStorePort["reissueAndRotate"]>[0],
  ) {
    const subject = this.subject(input.subject);
    const receipt = subject
      .collection("operationReceipts")
      .doc(operationReceiptId(input.idempotencyKey));
    try {
      return await this.database.runTransaction(async (transaction) => {
        const [receiptSnapshot, pointerSnapshot] = await Promise.all([
          transaction.get(receipt),
          transaction.get(subject),
        ]);
        if (receiptSnapshot.exists) {
          const data = receiptSnapshot.data();
          const credentialId = text(data, "credentialId");
          const credentialVersion = integer(data, "credentialVersion");
          return credentialId !== undefined && credentialVersion !== undefined
            ? ({ kind: "already-issued", credentialId, credentialVersion } as const)
            : ({ kind: "unavailable" } as const);
        }
        const pointer = pointerSnapshot.data() as SubjectPointer | undefined;
        const activeCredentialId =
          pointer?.status === "active" && typeof pointer.credentialId === "string"
            ? pointer.credentialId
            : undefined;
        const activeVersion =
          typeof pointer?.credentialVersion === "number" &&
          Number.isSafeInteger(pointer.credentialVersion)
            ? pointer.credentialVersion
            : 0;
        if (
          activeCredentialId !== input.currentCredentialId ||
          activeVersion !== input.expectedVersion
        ) {
          if (typeof pointer?.credentialId !== "string" || activeVersion < 1) {
            return { kind: "unavailable" as const };
          }
          transaction.create(receipt, {
            operation: "reissue-converged",
            credentialId: pointer.credentialId,
            credentialVersion: activeVersion,
            requestedAt: input.requestedAt,
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "already-issued" as const,
            credentialId: pointer.credentialId,
            credentialVersion: activeVersion,
          };
        }

        const credentialVersion = activeVersion + 1;
        transaction.set(
          this.household(input.subject)
            .collection(CREDENTIALS)
            .doc(activeCredentialId),
          {
            status: "revoked",
            revokedAt: input.requestedAt,
            replacedByCredentialId: input.credentialId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        transaction.create(
          this.household(input.subject)
            .collection(CREDENTIALS)
            .doc(input.credentialId),
          {
            credentialId: input.credentialId,
            credentialVersion,
            subjectUid: input.subject.subjectUid,
            householdId: input.subject.householdId,
            memberId: input.subject.memberId,
            capabilities: [CAPABILITY],
            issuedAt: input.requestedAt,
            keyVersion: input.keyVersion,
            secretHash: input.secretHash,
            status: "active",
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
        );
        transaction.set(subject, {
          ...input.subject,
          credentialId: input.credentialId,
          credentialVersion,
          status: "active",
          updatedAt: FieldValue.serverTimestamp(),
          schemaVersion: 1,
        });
        transaction.create(receipt, {
          operation: "reissue",
          credentialId: input.credentialId,
          credentialVersion,
          requestedAt: input.requestedAt,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        return {
          kind: "issued" as const,
          credentialId: input.credentialId,
          credentialVersion,
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async findBySecretHash(
    secretHash: string,
  ): Promise<ShortcutCredentialRecordView | undefined> {
    const snapshot = await this.database
      .collectionGroup(CREDENTIALS)
      .where("secretHash", "==", secretHash)
      .limit(2)
      .get();
    if (snapshot.size !== 1) return undefined;
    const document = snapshot.docs[0];
    const value = credentialView(document.id, document.data());
    return value !== undefined &&
      document.ref.parent.parent?.id === value.householdId
      ? value
      : undefined;
  }

  async findLatestForSubject(
    subjectInput: ShortcutCredentialSubject,
  ): Promise<ShortcutCredentialRecordView | undefined> {
    const pointer = await this.subject(subjectInput).get();
    const credentialId = text(pointer.data(), "credentialId");
    if (credentialId === undefined) return undefined;
    const credential = await this.household(subjectInput)
      .collection(CREDENTIALS)
      .doc(credentialId)
      .get();
    const value = credentialView(credential.id, credential.data());
    return value !== undefined && sameSubject(value, subjectInput)
      ? value
      : undefined;
  }

  async markUsed(input: {
    readonly credentialId: string;
    readonly householdId: string;
    readonly requestedAt: string;
  }): Promise<void> {
    await this.database
      .collection(HOUSEHOLDS)
      .doc(input.householdId)
      .collection(CREDENTIALS)
      .doc(input.credentialId)
      .set(
        {
          lastUsedAt: input.requestedAt,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }

  async revokeOwned(
    input: Parameters<ShortcutCredentialStorePort["revokeOwned"]>[0],
  ): Promise<RevokeShortcutCredentialResult> {
    const subject = this.subject(input.subject);
    const receipt = subject
      .collection("operationReceipts")
      .doc(operationReceiptId(input.idempotencyKey));
    const credential = this.household(input.subject)
      .collection(CREDENTIALS)
      .doc(input.credentialId);
    return this.database.runTransaction(async (transaction) => {
      const [receiptSnapshot, credentialSnapshot] = await Promise.all([
        transaction.get(receipt),
        transaction.get(credential),
      ]);
      if (receiptSnapshot.exists) {
        const data = receiptSnapshot.data();
        const kind = text(data, "resultKind");
        const credentialId = text(data, "credentialId");
        const credentialVersion = integer(data, "credentialVersion");
        if (
          kind === "revoked" &&
          credentialId !== undefined &&
          credentialVersion !== undefined
        ) {
          return { kind, credentialId, credentialVersion };
        }
        if (kind === "alreadyRevoked" && credentialId !== undefined) {
          return { kind, credentialId };
        }
      }
      const value = credentialView(
        credentialSnapshot.id,
        credentialSnapshot.data(),
      );
      if (value === undefined) return { kind: "notFound" as const };
      if (!sameSubject(value, input.subject)) {
        return {
          kind: "forbidden" as const,
          code: "HOUSEHOLD_FORBIDDEN" as const,
        };
      }
      if (value.status === "revoked") {
        transaction.create(receipt, {
          operation: "revoke",
          resultKind: "alreadyRevoked",
          credentialId: value.credentialId,
          requestedAt: input.requestedAt,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { kind: "alreadyRevoked" as const, credentialId: value.credentialId };
      }
      if (value.credentialVersion !== input.expectedVersion) {
        return {
          kind: "conflict" as const,
          code: "CREDENTIAL_VERSION_MISMATCH" as const,
        };
      }
      const credentialVersion = value.credentialVersion + 1;
      transaction.update(credential, {
        status: "revoked",
        credentialVersion,
        revokedAt: input.requestedAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(
        subject,
        {
          credentialId: value.credentialId,
          credentialVersion,
          status: "revoked",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.create(receipt, {
        operation: "revoke",
        resultKind: "revoked",
        credentialId: value.credentialId,
        credentialVersion,
        requestedAt: input.requestedAt,
        schemaVersion: 1,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { kind: "revoked" as const, credentialId: value.credentialId, credentialVersion };
    });
  }
}
