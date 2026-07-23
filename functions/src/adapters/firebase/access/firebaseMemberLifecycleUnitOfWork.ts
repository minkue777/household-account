import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  MemberLifecycleMutation,
  MemberLifecycleUnitOfWorkPort,
} from "../../../contexts/access/member-lifecycle/application/ports/out/memberLifecycleUnitOfWorkPort";
import type {
  MemberLifecycleAggregate,
  MemberLifecycleReceipt,
  StoredMemberLifecycleResult,
} from "../../../contexts/access/member-lifecycle/domain/model/memberLifecycle";
import { STANDARD_MEMBER_CAPABILITIES } from "../../../contexts/access/google-onboarding/domain/policies/googleOnboardingPolicy";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import {
  ACCESS_SCHEMA_VERSION,
  accessEventId,
  accessReceiptReference,
  numberField,
  principalClaimId,
  sha256,
  stringArrayField,
  stringField,
  terminalReceiptFields,
} from "./firebaseAccessPersistence";

export interface FirebaseMemberLifecycleUnitOfWorkInput {
  readonly administratorPrincipalRef: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly operation: "remove" | "restore";
  readonly reason?: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly commandId: string;
}

interface LoadedMemberLifecycleState {
  readonly state: MemberLifecycleAggregate;
  readonly memberSnapshots: ReadonlyMap<string, firestore.DocumentSnapshot>;
  readonly membershipSnapshots: ReadonlyMap<string, firestore.DocumentSnapshot>;
  readonly profileSnapshots: ReadonlyMap<string, firestore.DocumentSnapshot>;
  readonly claimSnapshots: ReadonlyMap<string, firestore.DocumentSnapshot>;
  readonly receiptSnapshot: firestore.DocumentSnapshot;
}

function lifecycleState(
  value: FirebaseFirestore.DocumentData | undefined,
): "active" | "removed" {
  return stringField(value, "lifecycleState") === "removed" ||
    stringField(value, "status") === "removed"
    ? "removed"
    : "active";
}

function storedResult(value: unknown): StoredMemberLifecycleResult | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const result = value as Record<string, unknown>;
  if (
    result.kind === "already-processed" &&
    typeof result.memberId === "string" &&
    typeof result.membershipVersion === "number"
  ) {
    return {
      kind: "already-processed",
      memberId: result.memberId,
      membershipVersion: result.membershipVersion,
    };
  }
  if (
    result.kind === "success" &&
    typeof result.memberId === "string" &&
    (result.membershipStatus === "active" ||
      result.membershipStatus === "removed") &&
    typeof result.membershipVersion === "number"
  ) {
    return {
      kind: "success",
      memberId: result.memberId,
      membershipStatus: result.membershipStatus,
      membershipVersion: result.membershipVersion,
    };
  }
  return undefined;
}

function changed<T>(before: T | undefined, after: T): boolean {
  return before === undefined || JSON.stringify(before) !== JSON.stringify(after);
}

export class FirebaseMemberLifecycleUnitOfWork
  implements MemberLifecycleUnitOfWorkPort
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly input: FirebaseMemberLifecycleUnitOfWorkInput,
  ) {}

  private async load(
    transaction: firestore.Transaction,
  ): Promise<LoadedMemberLifecycleState> {
    const householdReference = this.database
      .collection("households")
      .doc(this.input.householdId);
    const receiptReference = accessReceiptReference(
      this.database,
      "access-member-lifecycle",
      this.input.administratorPrincipalRef,
      this.input.idempotencyKey,
    );
    const [household, members, memberships, profiles, receiptSnapshot] =
      await Promise.all([
        transaction.get(householdReference),
        transaction.get(householdReference.collection("members")),
        transaction.get(householdReference.collection("memberships")),
        transaction.get(householdReference.collection("assetOwnerProfiles")),
        transaction.get(receiptReference),
      ]);
    if (!household.exists) throw new Error("HOUSEHOLD_NOT_FOUND");
    const householdLifecycle =
      stringField(household.data(), "lifecycleState") ??
      (household.data()?.deletedAt === undefined ? "active" : "deleted");
    if (householdLifecycle !== "active") {
      throw new Error("HOUSEHOLD_NOT_ACTIVE");
    }

    const membershipSnapshots = new Map(
      memberships.docs.map((snapshot) => [snapshot.id, snapshot]),
    );
    const claimSnapshots = new Map<string, firestore.DocumentSnapshot>();
    await Promise.all(
      memberships.docs.map(async (membership) => {
        const principalUid =
          stringField(membership.data(), "principalUid") ?? membership.id;
        const claim = await transaction.get(
          this.database
            .collection("principalMembershipClaims")
            .doc(principalClaimId(principalUid)),
        );
        claimSnapshots.set(principalUid, claim);
      }),
    );

    const receipts: MemberLifecycleReceipt[] = [];
    if (receiptSnapshot.exists) {
      const result = storedResult(receiptSnapshot.data()?.result);
      const fingerprint = stringField(
        receiptSnapshot.data(),
        "payloadFingerprint",
      );
      if (result !== undefined && fingerprint !== undefined) {
        receipts.push({
          idempotencyKey: this.input.idempotencyKey,
          payloadFingerprint: fingerprint,
          result,
        });
      }
    }

    return {
      state: {
        household: {
          householdId: this.input.householdId,
          lifecycleState: "active",
        },
        members: members.docs.flatMap((snapshot) => {
          const data = snapshot.data();
          const principalUid = stringField(data, "linkedPrincipalUid");
          if (principalUid === undefined) return [];
          return [
            {
              principalUid,
              memberId: snapshot.id,
              origin:
                stringField(data, "origin") === "creator"
                  ? ("creator" as const)
                  : ("invitee" as const),
              status: lifecycleState(data),
              version: numberField(data, "aggregateVersion", 1),
            },
          ];
        }),
        memberships: memberships.docs.flatMap((snapshot) => {
          const data = snapshot.data();
          const memberId = stringField(data, "memberId");
          if (memberId === undefined) return [];
          return [
            {
              principalUid:
                stringField(data, "principalUid") ?? snapshot.id,
              householdId: this.input.householdId,
              memberId,
              status: lifecycleState(data),
              version: numberField(data, "aggregateVersion", 1),
            },
          ];
        }),
        memberOwnerProfiles: profiles.docs.flatMap((snapshot) => {
          const data = snapshot.data();
          const linkedMemberId = stringField(data, "linkedMemberId");
          if (
            linkedMemberId === undefined ||
            stringField(data, "profileType") === "dependent"
          ) {
            return [];
          }
          return [
            {
              profileId: snapshot.id,
              linkedMemberId,
              lifecycleState:
                stringField(data, "lifecycleState") === "archived"
                  ? ("archived" as const)
                  : ("active" as const),
            },
          ];
        }),
        principalClaims: [...claimSnapshots.entries()].flatMap(
          ([principalUid, snapshot]) => {
            const data = snapshot.data();
            const householdId = stringField(data, "householdId");
            const memberId = stringField(data, "memberId");
            return snapshot.exists &&
              householdId !== undefined &&
              memberId !== undefined
              ? [{ principalUid, householdId, memberId }]
              : [];
          },
        ),
        receipts,
        events: [],
      },
      memberSnapshots: new Map(
        members.docs.map((snapshot) => [snapshot.id, snapshot]),
      ),
      membershipSnapshots,
      profileSnapshots: new Map(
        profiles.docs.map((snapshot) => [snapshot.id, snapshot]),
      ),
      claimSnapshots,
      receiptSnapshot,
    };
  }

  async read(): Promise<MemberLifecycleAggregate> {
    return this.database.runTransaction(async (transaction) =>
      (await this.load(transaction)).state,
    );
  }

  async transact<T>(
    operation: (
      state: MemberLifecycleAggregate,
    ) => MemberLifecycleMutation<T>,
  ): Promise<T> {
    return this.database.runTransaction(async (transaction) => {
      const loaded = await this.load(transaction);
      const mutation = operation(loaded.state);
      this.persist(transaction, loaded, mutation.state);
      return mutation.value;
    });
  }

  private persist(
    transaction: firestore.Transaction,
    loaded: LoadedMemberLifecycleState,
    state: MemberLifecycleAggregate,
  ): void {
    const householdReference = this.database
      .collection("households")
      .doc(this.input.householdId);
    const beforeMembers = new Map(
      loaded.state.members.map((member) => [member.memberId, member]),
    );
    const beforeMemberships = new Map(
      loaded.state.memberships.map((membership) => [
        membership.principalUid,
        membership,
      ]),
    );
    const beforeProfiles = new Map(
      loaded.state.memberOwnerProfiles.map((profile) => [profile.profileId, profile]),
    );

    for (const member of state.members) {
      if (!changed(beforeMembers.get(member.memberId), member)) continue;
      const reference = householdReference.collection("members").doc(member.memberId);
      transaction.set(
        reference,
        {
          lifecycleState: member.status,
          aggregateVersion: member.version,
          ...(member.status === "removed"
            ? {
                removedAt: this.input.requestedAt,
                removedByHash: sha256(this.input.administratorPrincipalRef),
                removalReason: this.input.reason?.trim() ?? "administrator",
              }
            : {
                restoredAt: this.input.requestedAt,
                restoredByHash: sha256(this.input.administratorPrincipalRef),
              }),
          schemaVersion: ACCESS_SCHEMA_VERSION,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    for (const membership of state.memberships) {
      if (!changed(beforeMemberships.get(membership.principalUid), membership)) {
        continue;
      }
      const reference = householdReference
        .collection("memberships")
        .doc(membership.principalUid);
      transaction.set(
        reference,
        {
          principalUid: membership.principalUid,
          memberId: membership.memberId,
          householdId: membership.householdId,
          lifecycleState: membership.status,
          status: membership.status,
          aggregateVersion: membership.version,
          ...(membership.status === "removed"
            ? {
                removedAt: this.input.requestedAt,
                removedByHash: sha256(this.input.administratorPrincipalRef),
                removalReason: this.input.reason?.trim() ?? "administrator",
              }
            : {
                restoredAt: this.input.requestedAt,
                restoredByHash: sha256(this.input.administratorPrincipalRef),
              }),
          schemaVersion: ACCESS_SCHEMA_VERSION,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    for (const profile of state.memberOwnerProfiles) {
      if (!changed(beforeProfiles.get(profile.profileId), profile)) continue;
      const snapshot = loaded.profileSnapshots.get(profile.profileId);
      transaction.set(
        householdReference.collection("assetOwnerProfiles").doc(profile.profileId),
        {
          lifecycleState: profile.lifecycleState,
          aggregateVersion: numberField(snapshot?.data(), "aggregateVersion", 1) + 1,
          schemaVersion: ACCESS_SCHEMA_VERSION,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    const beforeClaims = new Map(
      loaded.state.principalClaims.map((claim) => [claim.principalUid, claim]),
    );
    const afterClaims = new Map(
      state.principalClaims.map((claim) => [claim.principalUid, claim]),
    );
    const touchedPrincipals = new Set([
      ...beforeClaims.keys(),
      ...afterClaims.keys(),
    ]);
    for (const principalUid of touchedPrincipals) {
      const before = beforeClaims.get(principalUid);
      const after = afterClaims.get(principalUid);
      if (before !== undefined && after === undefined) {
        transaction.delete(
          this.database
            .collection("principalMembershipClaims")
            .doc(principalClaimId(principalUid)),
        );
        transaction.delete(
          this.database
            .collection("users")
            .doc(principalUid)
            .collection("householdMembershipViews")
            .doc(this.input.householdId),
        );
        continue;
      }
      if (after === undefined || !changed(before, after)) continue;
      const membership = state.memberships.find(
        (candidate) => candidate.principalUid === principalUid,
      );
      const member = state.members.find(
        (candidate) => candidate.memberId === after.memberId,
      );
      const membershipSnapshot = loaded.membershipSnapshots.get(principalUid);
      const memberSnapshot = loaded.memberSnapshots.get(after.memberId);
      const displayName =
        stringField(memberSnapshot?.data(), "displayName") ?? after.memberId;
      const capabilities = stringArrayField(
        membershipSnapshot?.data(),
        "capabilities",
      );
      const claimReference = this.database
        .collection("principalMembershipClaims")
        .doc(principalClaimId(principalUid));
      const membershipId = `${after.householdId}:${principalUid}`;
      transaction.set(claimReference, {
        claimId: claimReference.id,
        principalUid,
        householdId: after.householdId,
        memberId: after.memberId,
        membershipId,
        lifecycleState: "active",
        householdLifecycleState: "active",
        capabilities:
          capabilities.length === 0
            ? [...STANDARD_MEMBER_CAPABILITIES]
            : [...capabilities],
        aggregateVersion: membership?.version ?? 1,
        schemaVersion: ACCESS_SCHEMA_VERSION,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(
        this.database
          .collection("users")
          .doc(principalUid)
          .collection("householdMembershipViews")
          .doc(after.householdId),
        {
          principalUid,
          householdId: after.householdId,
          memberId: after.memberId,
          membershipId,
          displayName,
          lifecycleState: "active",
          status: "active",
          capabilities:
            capabilities.length === 0
              ? [...STANDARD_MEMBER_CAPABILITIES]
              : [...capabilities],
          aggregateVersion: membership?.version ?? 1,
          memberAggregateVersion: member?.version ?? 1,
          sourceVersion: membership?.version ?? 1,
          sourceCheckpoint: this.input.requestedAt,
          projectedAt: FieldValue.serverTimestamp(),
          schemaVersion: ACCESS_SCHEMA_VERSION,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    for (const event of state.events) {
      new FirebaseTransactionalOutbox(this.database).append(transaction, {
        eventId: accessEventId(
          this.input.commandId,
          event.eventType,
          event.memberId,
        ),
        eventType: event.eventType,
        householdId: event.householdId,
        aggregateId: event.memberId,
        aggregateVersion: event.membershipVersion,
        occurredAt: this.input.requestedAt,
        correlationId: this.input.commandId,
        causationId: this.input.commandId,
        payload: {
          householdId: event.householdId,
          memberId: event.memberId,
          membershipVersion: event.membershipVersion,
        },
      });
    }

    const nextReceipt = state.receipts.find(
      (receipt) => receipt.idempotencyKey === this.input.idempotencyKey,
    );
    if (!loaded.receiptSnapshot.exists && nextReceipt !== undefined) {
      transaction.create(
        loaded.receiptSnapshot.ref,
        terminalReceiptFields({
          principalUid: this.input.administratorPrincipalRef,
          householdId: this.input.householdId,
          payloadFingerprint: nextReceipt.payloadFingerprint,
          result: nextReceipt.result,
          completedAt: this.input.requestedAt,
        }),
      );
    }
  }
}
