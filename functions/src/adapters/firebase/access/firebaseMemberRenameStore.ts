import { createHash } from "node:crypto";
import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { VerifiedMemberRenameActor } from "../../../contexts/access/member-rename/application/ports/in/memberRenameInputPort";
import type { MemberRenameMutation, MemberRenameSnapshot, MemberRenameStorePort } from "../../../contexts/access/member-rename/application/ports/out/memberRenameStorePort";
import type { MemberRenameReceipt, RenameableHouseholdMember } from "../../../contexts/access/member-rename/domain/model/memberRename";
import { memberRenamedEvent } from "../../../contexts/access/member-rename/domain/policies/memberRenamePolicy";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class FirebaseMemberRenameStore implements MemberRenameStorePort {
  constructor(
    private readonly database: firestore.Firestore,
    private readonly householdId: string,
    private readonly requestedAt: string,
    private readonly commandId: string,
    private readonly scope: { readonly principalUid: string; readonly memberId: string; readonly idempotencyKey: string },
  ) {}

  async transact<T>(actor: VerifiedMemberRenameActor, displayName: string, idempotencyKey: string,
    operation: (snapshot: MemberRenameSnapshot) => MemberRenameMutation<T>): Promise<T> {
    const householdRef = this.database.doc(`households/${this.householdId}`);
    const memberRef = householdRef.collection("members").doc(this.scope.memberId);
    const receiptRef = this.database.collection("commandReceipts/access-member-rename/receipts")
      .doc(hash(`${this.householdId}\u0000${idempotencyKey}`));
    return this.database.runTransaction(async transaction => {
      const [household, memberDoc, membership, receiptDoc] = await transaction.getAll(
        householdRef, memberRef, householdRef.collection("memberships").doc(this.scope.principalUid), receiptRef,
      );
      if (!household.exists) throw new Error("Household not found");
      const collisions = await transaction.get(householdRef.collection("members").where("displayName", "==", displayName));
      const profiles = await transaction.get(householdRef.collection("assetOwnerProfiles").where("linkedMemberId", "==", this.scope.memberId));
      const legacy: Record<string, unknown>[] = Array.isArray(household.get("members"))
        ? household.get("members").filter((value: unknown) => typeof value === "object" && value !== null) : [];
      const legacySelf = legacy.find(value => value.id === this.scope.memberId);
      const data = memberDoc.data();
      const member: RenameableHouseholdMember | undefined = data && typeof data.linkedPrincipalUid === "string" && typeof data.displayName === "string"
        ? { principalUid: data.linkedPrincipalUid, memberId: memberDoc.id, displayName: data.displayName,
          aggregateVersion: typeof data.aggregateVersion === "number" ? data.aggregateVersion : 1 }
        : legacySelf && typeof legacySelf.name === "string"
          ? { principalUid: this.scope.principalUid, memberId: this.scope.memberId, displayName: legacySelf.name,
            aggregateVersion: typeof legacySelf.aggregateVersion === "number" ? legacySelf.aggregateVersion : 1 } : undefined;
      const activeSelf = actor.householdId === this.householdId && actor.principalUid === this.scope.principalUid
        && actor.actingMemberId === this.scope.memberId && idempotencyKey === this.scope.idempotencyKey
        && membership.get("memberId") === this.scope.memberId
        && membership.get("lifecycleState") !== "removed" && membership.get("status") !== "removed";
      const mutation = operation({ member, activeSelf,
        displayNameTaken: collisions.docs.some(doc => doc.id !== this.scope.memberId)
          || (!memberDoc.exists && legacy.some(value => value.id !== this.scope.memberId && value.name === displayName)),
        receipt: receiptDoc.get("receipt") as MemberRenameReceipt | undefined,
      });
      if (!mutation.change) return mutation.value;
      const { member: renamed, receipt } = mutation.change;
      transaction.set(memberRef, {
        householdId: this.householdId, memberId: renamed.memberId, linkedPrincipalUid: renamed.principalUid,
        displayName: renamed.displayName, aggregateVersion: renamed.aggregateVersion, schemaVersion: 2,
        updatedAt: FieldValue.serverTimestamp(),
        ...(memberDoc.exists ? {} : { lifecycleState: "active", createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
      transaction.update(this.database.doc(`users/${this.scope.principalUid}/householdMembershipViews/${this.householdId}`), {
        displayName: renamed.displayName, memberAggregateVersion: renamed.aggregateVersion,
        projectedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      for (const profile of profiles.docs) {
        transaction.update(profile.ref, { displayName: renamed.displayName, updatedAt: FieldValue.serverTimestamp() });
      }
      transaction.set(receiptRef, { householdId: this.householdId, receipt, status: "completed", terminalAt: this.requestedAt,
        expiresAt: firestoreTtlAfter(this.requestedAt), schemaVersion: 1 });
      new FirebaseTransactionalOutbox(this.database).append(transaction, {
        eventId: hash(`${this.commandId}\u0000${renamed.memberId}`), eventType: "MemberRenamed.v1",
        householdId: this.householdId, aggregateId: renamed.memberId, aggregateVersion: renamed.aggregateVersion,
        occurredAt: this.requestedAt, correlationId: this.commandId, causationId: this.commandId,
        payload: { ...memberRenamedEvent(this.householdId, renamed) },
      });
      // 가구 문서가 동일 이름을 동시에 선점하는 변경도 직렬화합니다.
      transaction.update(householdRef, {
        ...(Array.isArray(household.get("members")) ? { members: household.get("members").map((value: unknown) => {
          if (typeof value !== "object" || value === null || (value as Record<string, unknown>).id !== renamed.memberId) return value;
          return { ...value, name: renamed.displayName, aggregateVersion: renamed.aggregateVersion };
        }) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return mutation.value;
    });
  }
}
