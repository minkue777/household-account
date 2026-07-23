import { createHash, randomBytes } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { firestoreTtlAfter } from "../shared/firestoreTtl";
import { principalClaimId } from "./firebasePrincipalMembershipClaim";

export { principalClaimId } from "./firebasePrincipalMembershipClaim";

export const ACCESS_SCHEMA_VERSION = 2;
export const ACCESS_RECEIPT_TTL_MILLIS = 30 * 24 * 60 * 60 * 1_000;

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function stableAccessId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}-${sha256(parts.join("\u0000")).slice(0, 32)}`;
}

export function memberOwnerProfileId(
  householdId: string,
  memberId: string,
): string {
  return stableAccessId("profile-member", householdId, memberId);
}

export function dependentOwnerProfileId(
  householdId: string,
  idempotencyKey: string,
): string {
  return stableAccessId("profile-dependent", householdId, idempotencyKey);
}

export function accessReceiptId(
  principalUid: string,
  idempotencyKey: string,
): string {
  return sha256(`${principalUid}\u0000${idempotencyKey}`);
}

export function accessEventId(
  commandId: string,
  eventType: string,
  aggregateId: string,
): string {
  return sha256(`${commandId}\u0000${eventType}\u0000${aggregateId}`);
}

export function issueInvitationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(8)]
    .map((value) => alphabet[value & 31])
    .join("");
}

export function stringField(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" && candidate.trim() !== ""
    ? candidate.trim()
    : undefined;
}

export function numberField(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
  fallback: number,
): number {
  const candidate = value?.[field];
  return typeof candidate === "number" && Number.isInteger(candidate)
    ? candidate
    : fallback;
}

export function stringArrayField(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
): readonly string[] {
  const candidate = value?.[field];
  return Array.isArray(candidate)
    ? candidate.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      )
    : [];
}

export function isoString(value: unknown): string | undefined {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate(): Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  return undefined;
}

export interface CanonicalAccessBinding {
  readonly principalUid: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly displayName: string;
  readonly memberAggregateVersion: number;
  readonly capabilities: readonly string[];
  readonly createdAtIso: string;
  readonly claimVersion?: number;
}

/**
 * Membership canonical 원본, 사용자별 read projection, UID 전역 claim을 같은
 * Firestore transaction에 기록합니다. 이름은 표시 정보일 뿐 claim key가 아닙니다.
 */
export function writeCanonicalAccessBinding(
  database: firestore.Firestore,
  transaction: firestore.Transaction,
  input: CanonicalAccessBinding,
): void {
  const householdReference = database
    .collection("households")
    .doc(input.householdId);
  const membershipReference = householdReference
    .collection("memberships")
    .doc(input.principalUid);
  const viewReference = database
    .collection("users")
    .doc(input.principalUid)
    .collection("householdMembershipViews")
    .doc(input.householdId);
  const claimReference = database
    .collection("principalMembershipClaims")
    .doc(principalClaimId(input.principalUid));
  const membershipId = `${input.householdId}:${input.principalUid}`;
  const common = {
    householdId: input.householdId,
    memberId: input.memberId,
    principalUid: input.principalUid,
    lifecycleState: "active",
    status: "active",
    capabilities: [...input.capabilities],
    aggregateVersion: input.claimVersion ?? 1,
    schemaVersion: ACCESS_SCHEMA_VERSION,
    updatedAt: FieldValue.serverTimestamp(),
  };

  transaction.set(membershipReference, {
    ...common,
    membershipId,
    createdAt: FieldValue.serverTimestamp(),
  });
  transaction.set(viewReference, {
    ...common,
    displayName: input.displayName,
    memberAggregateVersion: input.memberAggregateVersion,
    sourceVersion: input.claimVersion ?? 1,
    sourceCheckpoint: input.createdAtIso,
    projectedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
  transaction.set(claimReference, {
    claimId: claimReference.id,
    principalUid: input.principalUid,
    householdId: input.householdId,
    memberId: input.memberId,
    membershipId,
    lifecycleState: "active",
    aggregateVersion: input.claimVersion ?? 1,
    schemaVersion: ACCESS_SCHEMA_VERSION,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export function accessReceiptReference(
  database: firestore.Firestore,
  contextName: string,
  principalUid: string,
  idempotencyKey: string,
): firestore.DocumentReference {
  return database
    .collection("commandReceipts")
    .doc(contextName)
    .collection("receipts")
    .doc(accessReceiptId(principalUid, idempotencyKey));
}

export function terminalReceiptFields(input: {
  readonly principalUid: string;
  readonly householdId?: string;
  readonly payloadFingerprint: string;
  readonly result: unknown;
  readonly completedAt: string;
}): Readonly<Record<string, unknown>> {
  return {
    principalUid: input.principalUid,
    ...(input.householdId === undefined
      ? {}
      : { householdId: input.householdId }),
    payloadFingerprint: input.payloadFingerprint,
    result: input.result,
    status: "completed",
    terminalAt: input.completedAt,
    completedAt: input.completedAt,
    expiresAt: firestoreTtlAfter(
      input.completedAt,
      ACCESS_RECEIPT_TTL_MILLIS,
    ),
    schemaVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
