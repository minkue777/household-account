import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  LegacyMembershipMutation,
  LegacyMembershipResolutionRead,
  LegacyMembershipStorePort,
} from "../../../contexts/access/legacy-membership/application/ports/out/legacyMembershipStorePort";
import type {
  LegacyMember,
  LegacyMembership,
  LegacyMembershipState,
} from "../../../contexts/access/legacy-membership/domain/model/legacyMembership";
import { STANDARD_MEMBER_CAPABILITIES } from "../../../contexts/access/google-onboarding/domain/policies/googleOnboardingPolicy";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import {
  ACCESS_SCHEMA_VERSION,
  accessEventId,
  accessReceiptReference,
  memberOwnerProfileId,
  numberField,
  principalClaimId,
  sha256,
  stringField,
  terminalReceiptFields,
  writeCanonicalAccessBinding,
} from "./firebaseAccessPersistence";

export interface FirebaseLegacyMembershipStoreInput {
  readonly principalUid: string;
  readonly householdKey: string;
  readonly memberId: string;
  readonly presentedMemberName?: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly requestedAt: string;
  readonly commandId: string;
}

interface LoadedLegacyState {
  readonly state: LegacyMembershipState;
  readonly householdSnapshot: firestore.DocumentSnapshot;
  readonly memberSnapshot: firestore.DocumentSnapshot;
  readonly ownerProfileSnapshot: firestore.DocumentSnapshot;
  readonly memberAggregateVersion: number;
}

function legacyEmbeddedMember(
  householdId: string,
  household: FirebaseFirestore.DocumentData | undefined,
  memberId: string,
): LegacyMember | undefined {
  if (!Array.isArray(household?.members)) return undefined;
  const raw = household.members.find((candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    return (candidate as Record<string, unknown>).id === memberId;
  });
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const displayName = typeof value.name === "string" ? value.name.trim() : "";
  if (displayName === "") return undefined;
  const linkedPrincipalUid =
    typeof value.linkedPrincipalUid === "string" &&
    value.linkedPrincipalUid.trim() !== ""
      ? value.linkedPrincipalUid.trim()
      : undefined;
  return {
    householdId,
    memberId,
    displayName,
    ...(linkedPrincipalUid === undefined ? {} : { linkedPrincipalUid }),
  };
}

function legacyEmbeddedMemberVersion(
  household: FirebaseFirestore.DocumentData | undefined,
  memberId: string,
): number {
  if (!Array.isArray(household?.members)) return 1;
  const raw = household.members.find((candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    return (candidate as Record<string, unknown>).id === memberId;
  });
  return typeof raw === "object" && raw !== null
    ? numberField(raw as FirebaseFirestore.DocumentData, "aggregateVersion", 1)
    : 1;
}

function canonicalMember(
  householdId: string,
  snapshot: firestore.DocumentSnapshot,
): LegacyMember | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const displayName = stringField(data, "displayName");
  if (displayName === undefined) return undefined;
  const linkedPrincipalUid = stringField(data, "linkedPrincipalUid");
  return {
    householdId,
    memberId: snapshot.id,
    displayName,
    ...(linkedPrincipalUid === undefined ? {} : { linkedPrincipalUid }),
  };
}

function mappedMembership(
  principalUid: string,
  data: FirebaseFirestore.DocumentData | undefined,
): LegacyMembership | undefined {
  const householdId = stringField(data, "householdId");
  const memberId = stringField(data, "memberId");
  const status =
    stringField(data, "lifecycleState") ?? stringField(data, "status") ?? "active";
  return householdId !== undefined && memberId !== undefined && status === "active"
    ? {
        principalUid,
        householdId,
        memberId,
        status: "active",
      }
    : undefined;
}

export class FirebaseLegacyMembershipStore implements LegacyMembershipStorePort {
  constructor(
    private readonly database: firestore.Firestore,
    private readonly input: FirebaseLegacyMembershipStoreInput,
  ) {}

  private async load(
    transaction: firestore.Transaction,
  ): Promise<LoadedLegacyState> {
    const householdReference = this.database
      .collection("households")
      .doc(this.input.householdKey);
    const memberReference = householdReference
      .collection("members")
      .doc(this.input.memberId);
    const ownerProfileReference = householdReference
      .collection("assetOwnerProfiles")
      .doc(memberOwnerProfileId(this.input.householdKey, this.input.memberId));
    const claimReference = this.database
      .collection("principalMembershipClaims")
      .doc(principalClaimId(this.input.principalUid));
    const userViewsQuery = this.database
      .collection("users")
      .doc(this.input.principalUid)
      .collection("householdMembershipViews")
      .where("lifecycleState", "==", "active")
      .limit(2);
    const [householdSnapshot, memberSnapshot, ownerProfileSnapshot, claimSnapshot, views] =
      await Promise.all([
        transaction.get(householdReference),
        transaction.get(memberReference),
        transaction.get(ownerProfileReference),
        transaction.get(claimReference),
        transaction.get(userViewsQuery),
      ]);

    const householdData = householdSnapshot.data();
    const legacyHouseholdKey =
      stringField(householdData, "legacyHouseholdKey") ?? householdSnapshot.id;
    const lifecycleState =
      stringField(householdData, "lifecycleState") ??
      (householdData?.deletedAt === undefined ? "active" : "deleted");
    const targetMember =
      canonicalMember(this.input.householdKey, memberSnapshot) ??
      legacyEmbeddedMember(
        this.input.householdKey,
        householdData,
        this.input.memberId,
      );
    const memberNameMatches =
      this.input.presentedMemberName === undefined ||
      targetMember?.displayName.trim() === this.input.presentedMemberName.trim();

    const claimMembership = mappedMembership(
      this.input.principalUid,
      claimSnapshot.data(),
    );
    const viewMemberships = views.docs.flatMap((snapshot) => {
      const mapped = mappedMembership(this.input.principalUid, snapshot.data());
      return mapped === undefined ? [] : [mapped];
    });
    const memberships = claimMembership === undefined
      ? viewMemberships
      : [claimMembership];

    return {
      state: {
        households:
          householdSnapshot.exists && legacyHouseholdKey === this.input.householdKey
            ? [
                {
                  householdId: householdSnapshot.id,
                  legacyHouseholdKey,
                  lifecycleState: lifecycleState === "active" ? "active" : "deleted",
                },
              ]
            : [],
        members:
          targetMember !== undefined && memberNameMatches ? [targetMember] : [],
        memberships,
        memberOwnerProfiles: ownerProfileSnapshot.exists
          ? [
              {
                householdId: this.input.householdKey,
                profileId: ownerProfileSnapshot.id,
                linkedMemberId: this.input.memberId,
                lifecycleState: "active",
              },
            ]
          : [],
        auditEvents: [],
      },
      householdSnapshot,
      memberSnapshot,
      ownerProfileSnapshot,
      memberAggregateVersion: memberSnapshot.exists
        ? numberField(memberSnapshot.data(), "aggregateVersion", 1)
        : legacyEmbeddedMemberVersion(householdData, this.input.memberId),
    };
  }

  read(): Promise<LegacyMembershipState> {
    return this.database.runTransaction(async (transaction) =>
      (await this.load(transaction)).state,
    );
  }

  async readForResolution(): Promise<LegacyMembershipResolutionRead> {
    try {
      return { kind: "success", state: await this.read() };
    } catch {
      return { kind: "retryable-failure", code: "MEMBERSHIP_LOOKUP_UNAVAILABLE" };
    }
  }

  async transact<T>(
    operation: (current: LegacyMembershipState) => LegacyMembershipMutation<T>,
  ): Promise<T> {
    const receiptReference = accessReceiptReference(
      this.database,
      "access-legacy-membership",
      this.input.principalUid,
      this.input.idempotencyKey,
    );
    return this.database.runTransaction(async (transaction) => {
      const receipt = await transaction.get(receiptReference);
      if (receipt.exists) {
        if (receipt.data()?.payloadFingerprint !== this.input.payloadFingerprint) {
          throw new Error("Legacy membership idempotency payload mismatch");
        }
        return receipt.data()?.result as T;
      }

      const loaded = await this.load(transaction);
      const mutation = operation(loaded.state);
      const linkedMember = mutation.state.members.find(
        (member) =>
          member.householdId === this.input.householdKey &&
          member.memberId === this.input.memberId &&
          member.linkedPrincipalUid === this.input.principalUid,
      );
      const linkedMembership = mutation.state.memberships.find(
        (membership) =>
          membership.householdId === this.input.householdKey &&
          membership.memberId === this.input.memberId &&
          membership.principalUid === this.input.principalUid,
      );

      if (linkedMember !== undefined && linkedMembership !== undefined) {
        const householdReference = this.database
          .collection("households")
          .doc(linkedMember.householdId);
        const memberReference = householdReference
          .collection("members")
          .doc(linkedMember.memberId);
        const memberVersion = loaded.memberAggregateVersion;
        transaction.set(
          householdReference,
          {
            householdId: linkedMember.householdId,
            lifecycleState: "active",
            aggregateVersion: numberField(
              loaded.householdSnapshot.data(),
              "aggregateVersion",
              1,
            ),
            schemaVersion: ACCESS_SCHEMA_VERSION,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        transaction.set(
          memberReference,
          {
            householdId: linkedMember.householdId,
            memberId: linkedMember.memberId,
            linkedPrincipalUid: this.input.principalUid,
            displayName: linkedMember.displayName,
            lifecycleState: "active",
            aggregateVersion: memberVersion,
            schemaVersion: ACCESS_SCHEMA_VERSION,
            updatedAt: FieldValue.serverTimestamp(),
            ...(loaded.memberSnapshot.exists
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );

        const profileReference = householdReference
          .collection("assetOwnerProfiles")
          .doc(memberOwnerProfileId(linkedMember.householdId, linkedMember.memberId));
        transaction.set(
          profileReference,
          {
            householdId: linkedMember.householdId,
            profileId: profileReference.id,
            linkedMemberId: linkedMember.memberId,
            displayName: linkedMember.displayName,
            profileType: "member",
            lifecycleState: "active",
            aggregateVersion: numberField(
              loaded.ownerProfileSnapshot.data(),
              "aggregateVersion",
              1,
            ),
            schemaVersion: ACCESS_SCHEMA_VERSION,
            updatedAt: FieldValue.serverTimestamp(),
            ...(loaded.ownerProfileSnapshot.exists
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
        writeCanonicalAccessBinding(this.database, transaction, {
          principalUid: this.input.principalUid,
          householdId: linkedMember.householdId,
          memberId: linkedMember.memberId,
          displayName: linkedMember.displayName,
          memberAggregateVersion: memberVersion,
          capabilities: STANDARD_MEMBER_CAPABILITIES,
          createdAtIso: this.input.requestedAt,
        });

        const legacyClaimReference = this.database
          .collection("legacyMembershipClaims")
          .doc(
            sha256(
              `${this.input.householdKey}\u0000${this.input.memberId}\u0000${this.input.principalUid}`,
            ),
          );
        transaction.set(legacyClaimReference, {
          claimId: legacyClaimReference.id,
          householdId: linkedMember.householdId,
          memberId: linkedMember.memberId,
          principalUid: this.input.principalUid,
          status: "claimed",
          aggregateVersion: 1,
          schemaVersion: ACCESS_SCHEMA_VERSION,
          claimedAt: this.input.requestedAt,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        for (const event of mutation.state.auditEvents) {
          new FirebaseTransactionalOutbox(this.database).append(transaction, {
            eventId: accessEventId(
              this.input.commandId,
              "LegacyMembershipClaimed.v1",
              event.memberId,
            ),
            eventType: "LegacyMembershipClaimed.v1",
            householdId: event.householdId,
            aggregateId: event.memberId,
            aggregateVersion: memberVersion,
            occurredAt: this.input.requestedAt,
            correlationId: this.input.commandId,
            causationId: this.input.commandId,
            payload: {
              householdId: event.householdId,
              memberId: event.memberId,
            },
          });
        }
      }

      transaction.create(
        receiptReference,
        terminalReceiptFields({
          principalUid: this.input.principalUid,
          householdId: this.input.householdKey,
          payloadFingerprint: this.input.payloadFingerprint,
          result: mutation.value,
          completedAt: this.input.requestedAt,
        }),
      );
      return mutation.value;
    });
  }
}
