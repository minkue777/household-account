import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  MemberRenameMutation,
  MemberRenameStorePort,
} from "../../../contexts/access/member-rename/application/ports/out/memberRenameStorePort";
import type {
  MemberRenameReceipt,
  MemberRenameState,
  RenameableHouseholdMember,
} from "../../../contexts/access/member-rename/domain/model/memberRename";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function mapMemberships(
  snapshots: readonly firestore.QueryDocumentSnapshot[],
): MemberRenameState["memberships"] {
  return snapshots.flatMap((snapshot) => {
    const data = snapshot.data();
    const memberId = typeof data.memberId === "string" ? data.memberId : "";
    if (memberId === "") return [];
    return [
      {
        principalUid: snapshot.id,
        memberId,
        status:
          data.lifecycleState === "removed" || data.status === "removed"
            ? ("removed" as const)
            : ("active" as const),
      },
    ];
  });
}

function canonicalMembers(
  snapshots: readonly firestore.QueryDocumentSnapshot[],
): readonly RenameableHouseholdMember[] {
  return snapshots.flatMap((snapshot) => {
    const data = snapshot.data();
    if (
      typeof data.linkedPrincipalUid !== "string" ||
      typeof data.displayName !== "string"
    ) {
      return [];
    }
    return [
      {
        principalUid: data.linkedPrincipalUid,
        memberId: snapshot.id,
        displayName: data.displayName,
        aggregateVersion:
          typeof data.aggregateVersion === "number" ? data.aggregateVersion : 1,
      },
    ];
  });
}

function legacyMembers(
  household: FirebaseFirestore.DocumentData,
  memberships: MemberRenameState["memberships"],
): readonly RenameableHouseholdMember[] {
  if (!Array.isArray(household.members)) return [];
  return household.members.flatMap((raw): readonly RenameableHouseholdMember[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const value = raw as Record<string, unknown>;
    const memberId = typeof value.id === "string" ? value.id : "";
    const displayName = typeof value.name === "string" ? value.name : "";
    const principalUid = memberships.find(
      (membership) => membership.memberId === memberId,
    )?.principalUid;
    if (memberId === "" || displayName === "" || principalUid === undefined) {
      return [];
    }
    return [
      {
        principalUid,
        memberId,
        displayName,
        aggregateVersion:
          typeof value.aggregateVersion === "number" ? value.aggregateVersion : 1,
      },
    ];
  });
}

export class FirebaseMemberRenameStore implements MemberRenameStorePort {
  constructor(
    private readonly database: firestore.Firestore,
    private readonly householdId: string,
    private readonly requestedAt: string,
    private readonly commandId: string,
    private readonly scope: {
      readonly principalUid: string;
      readonly memberId: string;
      readonly idempotencyKey: string;
    },
  ) {}

  private async currentReceipt(transaction?: firestore.Transaction) {
    const reference = this.database.collection("commandReceipts").doc("access-member-rename")
      .collection("receipts").doc(hash(`${this.householdId}\u0000${this.scope.idempotencyKey}`));
    const snapshot = transaction === undefined ? await reference.get() : await transaction.get(reference);
    return { docs: snapshot.exists ? [snapshot] : [] };
  }

  private async load(): Promise<MemberRenameState> {
    const householdReference = this.database
      .collection("households")
      .doc(this.householdId);
    const [household, members, memberships, profiles, receipts] = await Promise.all([
      householdReference.get(),
      householdReference.collection("members").where("linkedPrincipalUid", "==", this.scope.principalUid).get(),
      householdReference.collection("memberships").where("memberId", "==", this.scope.memberId).get(),
      householdReference.collection("assetOwnerProfiles").where("linkedMemberId", "==", this.scope.memberId).get(),
      this.currentReceipt(),
    ]);
    if (!household.exists) throw new Error("Household not found");
    const mappedMemberships = mapMemberships(memberships.docs);
    const mappedCanonical = canonicalMembers(members.docs);
    return {
      householdId: this.householdId,
      members:
        mappedCanonical.length > 0
          ? mappedCanonical
          : legacyMembers(household.data() ?? {}, mappedMemberships),
      memberships: mappedMemberships,
      memberOwnerProfiles: profiles.docs.flatMap((snapshot) => {
        const data = snapshot.data();
        return typeof data.linkedMemberId === "string" &&
          typeof data.displayName === "string"
          ? [
              {
                profileId: snapshot.id,
                linkedMemberId: data.linkedMemberId,
                displayName: data.displayName,
              },
            ]
          : [];
      }),
      receipts: receipts.docs.flatMap((snapshot) => {
        const value = snapshot.data()?.receipt;
        return typeof value === "object" && value !== null
          ? [value as MemberRenameReceipt]
          : [];
      }),
      events: [],
    };
  }

  read(): Promise<MemberRenameState> {
    return this.load();
  }

  async transact<T>(
    operation: (state: MemberRenameState) => MemberRenameMutation<T>,
  ): Promise<T> {
    const householdReference = this.database
      .collection("households")
      .doc(this.householdId);
    return this.database.runTransaction(async (transaction) => {
      const [household, members, memberships, profiles, receipts] = await Promise.all([
        transaction.get(householdReference),
        transaction.get(householdReference.collection("members").where("linkedPrincipalUid", "==", this.scope.principalUid)),
        transaction.get(
          householdReference.collection("memberships").where("memberId", "==", this.scope.memberId),
        ),
        transaction.get(
          householdReference.collection("assetOwnerProfiles").where("linkedMemberId", "==", this.scope.memberId),
        ),
        this.currentReceipt(transaction),
      ]);
      if (!household.exists) throw new Error("Household not found");
      const mappedMemberships = mapMemberships(memberships.docs);
      const mappedCanonical = canonicalMembers(members.docs);
      const before: MemberRenameState = {
        householdId: this.householdId,
        members:
          mappedCanonical.length > 0
            ? mappedCanonical
            : legacyMembers(household.data() ?? {}, mappedMemberships),
        memberships: mappedMemberships,
        memberOwnerProfiles: profiles.docs.flatMap((snapshot) => {
          const data = snapshot.data();
          return typeof data.linkedMemberId === "string" &&
            typeof data.displayName === "string"
            ? [
                {
                  profileId: snapshot.id,
                  linkedMemberId: data.linkedMemberId,
                  displayName: data.displayName,
                },
              ]
            : [];
        }),
        receipts: receipts.docs.flatMap((snapshot) => {
          const value = snapshot.data()?.receipt;
          return typeof value === "object" && value !== null
            ? [value as MemberRenameReceipt]
            : [];
        }),
        events: [],
      };
      const mutation = operation(before);
      const existingMemberIds = new Set(members.docs.map((document) => document.id));
      const existingProfileIds = new Set(profiles.docs.map((document) => document.id));
      const changedMembers = mutation.state.members.filter((member) => {
        const previous = before.members.find((candidate) => candidate.memberId === member.memberId);
        return previous === undefined || previous.displayName !== member.displayName
          || previous.aggregateVersion !== member.aggregateVersion;
      });

      for (const member of changedMembers) {
        transaction.set(
          householdReference.collection("members").doc(member.memberId),
          {
            householdId: this.householdId,
            memberId: member.memberId,
            linkedPrincipalUid: member.principalUid,
            displayName: member.displayName,
            aggregateVersion: member.aggregateVersion,
            schemaVersion: 2,
            updatedAt: FieldValue.serverTimestamp(),
            ...(existingMemberIds.has(member.memberId)
              ? {}
              : { lifecycleState: "active", createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
        for (const membership of mutation.state.memberships) {
          if (
            membership.status !== "active" ||
            membership.memberId !== member.memberId
          ) {
            continue;
          }
          transaction.update(
            this.database
              .collection("users")
              .doc(membership.principalUid)
              .collection("householdMembershipViews")
              .doc(this.householdId),
            {
              displayName: member.displayName,
              memberAggregateVersion: member.aggregateVersion,
              projectedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
          );
        }
      }
      for (const profile of mutation.state.memberOwnerProfiles) {
        const previous = before.memberOwnerProfiles.find((candidate) => candidate.profileId === profile.profileId);
        if (previous?.displayName === profile.displayName) continue;
        transaction.set(
          householdReference.collection("assetOwnerProfiles").doc(profile.profileId),
          {
            householdId: this.householdId,
            profileId: profile.profileId,
            linkedMemberId: profile.linkedMemberId,
            displayName: profile.displayName,
            schemaVersion: 2,
            updatedAt: FieldValue.serverTimestamp(),
            ...(existingProfileIds.has(profile.profileId)
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
      }
      for (const receipt of mutation.state.receipts) {
        if (before.receipts.some((previous) => previous.idempotencyKey === receipt.idempotencyKey)) continue;
        transaction.set(
          this.database
            .collection("commandReceipts")
            .doc("access-member-rename")
            .collection("receipts")
            .doc(hash(`${this.householdId}\u0000${receipt.idempotencyKey}`)),
          {
            householdId: this.householdId,
            receipt,
            status: "completed",
            terminalAt: this.requestedAt,
            expiresAt: firestoreTtlAfter(this.requestedAt),
            schemaVersion: 1,
          },
          { merge: true },
        );
      }
      for (const event of mutation.state.events) {
        const eventId = hash(`${this.commandId}\u0000${event.memberId}`);
        new FirebaseTransactionalOutbox(this.database).append(transaction, {
          eventId,
          eventType: "MemberRenamed.v1",
          householdId: event.householdId,
          aggregateId: event.memberId,
          aggregateVersion:
            mutation.state.members.find(
              (member) => member.memberId === event.memberId,
            )?.aggregateVersion ?? 1,
          occurredAt: this.requestedAt,
          correlationId: this.commandId,
          causationId: this.commandId,
          payload: { ...event },
        });
      }

      const legacy = household.data()?.members;
      if (Array.isArray(legacy) && changedMembers.length > 0) {
        transaction.update(householdReference, {
          members: legacy.map((raw) => {
            if (typeof raw !== "object" || raw === null) return raw;
            const value = raw as Record<string, unknown>;
            const changed = changedMembers.find(
              (member) => member.memberId === value.id,
            );
            return changed === undefined
              ? raw
              : {
                  ...value,
                  name: changed.displayName,
                  aggregateVersion: changed.aggregateVersion,
                };
          }),
          schemaVersion: 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return mutation.value;
    });
  }
}
