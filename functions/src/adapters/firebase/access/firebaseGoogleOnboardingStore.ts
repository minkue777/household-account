import type * as firestore from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type {
  GoogleOnboardingMutation,
  GoogleOnboardingStorePort,
} from "../../../contexts/access/google-onboarding/application/ports/out/googleOnboardingStorePort";
import type {
  GoogleOnboardingState,
  HouseholdInvitation,
  OnboardingHousehold,
  OnboardingMember,
  OnboardingMembership,
} from "../../../contexts/access/google-onboarding/domain/model/googleOnboarding";
import { STANDARD_MEMBER_CAPABILITIES } from "../../../contexts/access/google-onboarding/domain/policies/googleOnboardingPolicy";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import {
  ACCESS_SCHEMA_VERSION,
  accessEventId,
  accessReceiptReference,
  isoString,
  memberOwnerProfileId,
  numberField,
  principalClaimId,
  stringArrayField,
  stringField,
  terminalReceiptFields,
  writeCanonicalAccessBinding,
} from "./firebaseAccessPersistence";

export type FirebaseGoogleOnboardingMode =
  | {
      readonly kind: "create";
      readonly householdId: string;
      readonly memberId: string;
    }
  | { readonly kind: "issue-invitation"; readonly householdId: string }
  | {
      readonly kind: "join";
      readonly invitationHash: string;
      readonly memberId: string;
    };

export interface FirebaseGoogleOnboardingStoreInput {
  readonly principalUid: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly requestedAt: string;
  readonly commandId: string;
  readonly mode: FirebaseGoogleOnboardingMode;
}

interface LoadedOnboardingState {
  readonly state: GoogleOnboardingState;
  readonly householdSnapshots: ReadonlyMap<string, firestore.DocumentSnapshot>;
  readonly memberSnapshots: ReadonlyMap<string, firestore.DocumentSnapshot>;
  readonly invitationSnapshot?: firestore.DocumentSnapshot;
}

function activeHousehold(
  snapshot: firestore.DocumentSnapshot,
): OnboardingHousehold | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const lifecycleState = stringField(data, "lifecycleState") ??
    (data?.deletedAt === undefined ? "active" : "deleted");
  const name = stringField(data, "name");
  return lifecycleState === "active" && name !== undefined
    ? { householdId: snapshot.id, name, lifecycleState: "active" }
    : undefined;
}

function canonicalMember(
  householdId: string,
  snapshot: firestore.DocumentSnapshot,
): OnboardingMember | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const linkedPrincipalUid = stringField(data, "linkedPrincipalUid");
  const displayName = stringField(data, "displayName");
  return linkedPrincipalUid !== undefined && displayName !== undefined
    ? {
        householdId,
        memberId: snapshot.id,
        linkedPrincipalUid,
        displayName,
      }
    : undefined;
}

function membership(
  householdId: string,
  principalUid: string,
  snapshot: firestore.DocumentSnapshot,
): OnboardingMembership | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const memberId = stringField(data, "memberId");
  const status =
    stringField(data, "lifecycleState") ?? stringField(data, "status") ?? "active";
  return memberId !== undefined && status === "active"
    ? {
        principalUid,
        householdId,
        memberId,
        status: "active",
        capabilities:
          stringArrayField(data, "capabilities").length === 0
            ? [...STANDARD_MEMBER_CAPABILITIES]
            : stringArrayField(data, "capabilities"),
      }
    : undefined;
}

function invitation(
  snapshot: firestore.DocumentSnapshot,
): HouseholdInvitation | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const householdId = stringField(data, "householdId");
  const expiresAt = isoString(data?.expiresAt);
  const status = stringField(data, "status");
  if (
    householdId === undefined ||
    expiresAt === undefined ||
    (status !== "issued" && status !== "used")
  ) {
    return undefined;
  }
  const usedByUid = stringField(data, "usedByUid");
  return {
    invitationHash: snapshot.id,
    householdId,
    expiresAt,
    status,
    ...(usedByUid === undefined ? {} : { usedByUid }),
  };
}

export class FirebaseGoogleOnboardingStore implements GoogleOnboardingStorePort {
  private transactionInvocation = 0;

  constructor(
    private readonly database: firestore.Firestore,
    private readonly input: FirebaseGoogleOnboardingStoreInput,
  ) {}

  private async load(
    transaction: firestore.Transaction,
  ): Promise<LoadedOnboardingState> {
    const claimReference = this.database
      .collection("principalMembershipClaims")
      .doc(principalClaimId(this.input.principalUid));
    const claimSnapshot = await transaction.get(claimReference);
    const households: OnboardingHousehold[] = [];
    const members: OnboardingMember[] = [];
    const memberships: OnboardingMembership[] = [];
    const householdSnapshots = new Map<string, firestore.DocumentSnapshot>();
    const memberSnapshots = new Map<string, firestore.DocumentSnapshot>();
    let invitationSnapshot: firestore.DocumentSnapshot | undefined;

    let householdId: string | undefined;
    let memberId: string | undefined;
    if (this.input.mode.kind === "create") {
      householdId = this.input.mode.householdId;
      memberId = this.input.mode.memberId;
    } else if (this.input.mode.kind === "issue-invitation") {
      householdId = this.input.mode.householdId;
    } else {
      memberId = this.input.mode.memberId;
      invitationSnapshot = await transaction.get(
        this.database
          .collection("householdInvitations")
          .doc(this.input.mode.invitationHash),
      );
      householdId = invitation(invitationSnapshot)?.householdId;
    }

    if (householdId !== undefined) {
      const householdReference = this.database.collection("households").doc(householdId);
      const [householdSnapshot, membershipSnapshot] = await Promise.all([
        transaction.get(householdReference),
        transaction.get(
          householdReference.collection("memberships").doc(this.input.principalUid),
        ),
      ]);
      householdSnapshots.set(householdId, householdSnapshot);
      const mappedHousehold = activeHousehold(householdSnapshot);
      if (mappedHousehold !== undefined) households.push(mappedHousehold);
      const mappedMembership = membership(
        householdId,
        this.input.principalUid,
        membershipSnapshot,
      );
      if (mappedMembership !== undefined) memberships.push(mappedMembership);

      if (memberId !== undefined) {
        const memberSnapshot = await transaction.get(
          householdReference.collection("members").doc(memberId),
        );
        memberSnapshots.set(`${householdId}\u0000${memberId}`, memberSnapshot);
        const mappedMember = canonicalMember(householdId, memberSnapshot);
        if (mappedMember !== undefined) members.push(mappedMember);
      }
    }

    const claimData = claimSnapshot.data();
    const claimHouseholdId = stringField(claimData, "householdId");
    const claimMemberId = stringField(claimData, "memberId");
    return {
      state: {
        households,
        members,
        memberships,
        principalClaims:
          claimSnapshot.exists &&
          claimHouseholdId !== undefined &&
          claimMemberId !== undefined
            ? [
                {
                  principalUid: this.input.principalUid,
                  householdId: claimHouseholdId,
                  memberId: claimMemberId,
                  version: numberField(claimData, "aggregateVersion", 1),
                },
              ]
            : [],
        initializations: households.map((household) => ({
          householdId: household.householdId,
          status:
            householdSnapshots.get(household.householdId)?.data()
              ?.initializationStatus === "completed"
              ? "completed"
              : householdSnapshots.get(household.householdId)?.data()
                    ?.initializationStatus === "failed"
                ? "failed"
                : "pending",
        })),
        invitations:
          invitationSnapshot === undefined || invitation(invitationSnapshot) === undefined
            ? []
            : [invitation(invitationSnapshot) as HouseholdInvitation],
        events: [],
      },
      householdSnapshots,
      memberSnapshots,
      ...(invitationSnapshot === undefined ? {} : { invitationSnapshot }),
    };
  }

  async read(): Promise<GoogleOnboardingState> {
    return this.database.runTransaction(async (transaction) =>
      (await this.load(transaction)).state,
    );
  }

  async transact<T>(
    operation: (current: GoogleOnboardingState) => GoogleOnboardingMutation<T>,
  ): Promise<T> {
    this.transactionInvocation += 1;
    const isPrimaryTransaction = this.transactionInvocation === 1;
    const receiptReference = accessReceiptReference(
      this.database,
      "access-google-onboarding",
      this.input.principalUid,
      this.input.idempotencyKey,
    );

    return this.database.runTransaction(async (transaction) => {
      if (isPrimaryTransaction) {
        const receipt = await transaction.get(receiptReference);
        if (receipt.exists) {
          if (receipt.data()?.payloadFingerprint !== this.input.payloadFingerprint) {
            throw new Error("Access onboarding idempotency payload mismatch");
          }
          return receipt.data()?.result as T;
        }
      }

      const loaded = await this.load(transaction);
      const mutation = operation(loaded.state);
      this.persistMutation(
        transaction,
        loaded,
        mutation.state,
        isPrimaryTransaction,
      );

      if (isPrimaryTransaction) {
        const safeResult =
          this.input.mode.kind === "issue-invitation" &&
          typeof mutation.value === "object" &&
          mutation.value !== null &&
          (mutation.value as { kind?: unknown }).kind === "success"
            ? {
                kind: "forbidden",
                code: "INVITATION_ALREADY_ISSUED",
              }
            : mutation.value;
        transaction.create(
          receiptReference,
          terminalReceiptFields({
            principalUid: this.input.principalUid,
            ...(this.input.mode.kind === "issue-invitation"
              ? { householdId: this.input.mode.householdId }
              : {}),
            payloadFingerprint: this.input.payloadFingerprint,
            result: safeResult,
            completedAt: this.input.requestedAt,
          }),
        );
      }
      return mutation.value;
    });
  }

  private persistMutation(
    transaction: firestore.Transaction,
    loaded: LoadedOnboardingState,
    state: GoogleOnboardingState,
    persistIdentityGraph: boolean,
  ): void {
    const outbox = new FirebaseTransactionalOutbox(this.database);

    for (const household of state.households) {
      const reference = this.database.collection("households").doc(household.householdId);
      const existing = loaded.householdSnapshots.get(household.householdId);
      const initializationStatus = state.initializations.find(
        (candidate) => candidate.householdId === household.householdId,
      )?.status;
      const fields = {
        householdId: household.householdId,
        name: household.name,
        lifecycleState: household.lifecycleState,
        aggregateVersion: numberField(existing?.data(), "aggregateVersion", 1),
        initializationStatus: initializationStatus ?? "pending",
        schemaVersion: ACCESS_SCHEMA_VERSION,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing?.exists === true
          ? {}
          : { createdAt: FieldValue.serverTimestamp() }),
      };
      if (existing?.exists === true) transaction.set(reference, fields, { merge: true });
      else transaction.create(reference, fields);
    }

    if (!persistIdentityGraph) return;

    for (const member of state.members) {
      const householdReference = this.database
        .collection("households")
        .doc(member.householdId);
      const memberReference = householdReference.collection("members").doc(member.memberId);
      const existing = loaded.memberSnapshots.get(
        `${member.householdId}\u0000${member.memberId}`,
      );
      const memberVersion = numberField(existing?.data(), "aggregateVersion", 1);
      const memberFields = {
        householdId: member.householdId,
        memberId: member.memberId,
        linkedPrincipalUid: member.linkedPrincipalUid,
        displayName: member.displayName,
        lifecycleState: "active",
        aggregateVersion: memberVersion,
        schemaVersion: ACCESS_SCHEMA_VERSION,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing?.exists === true
          ? {}
          : { createdAt: FieldValue.serverTimestamp() }),
      };
      if (existing?.exists === true) {
        transaction.set(memberReference, memberFields, { merge: true });
      } else {
        transaction.create(memberReference, memberFields);
      }

      const profileReference = householdReference
        .collection("assetOwnerProfiles")
        .doc(memberOwnerProfileId(member.householdId, member.memberId));
      transaction.set(
        profileReference,
        {
          householdId: member.householdId,
          profileId: profileReference.id,
          linkedMemberId: member.memberId,
          displayName: member.displayName,
          profileType: "member",
          lifecycleState: "active",
          aggregateVersion: 1,
          schemaVersion: ACCESS_SCHEMA_VERSION,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      const linkedMembership = state.memberships.find(
        (candidate) =>
          candidate.householdId === member.householdId &&
          candidate.memberId === member.memberId &&
          candidate.principalUid === member.linkedPrincipalUid,
      );
      if (linkedMembership !== undefined) {
        writeCanonicalAccessBinding(this.database, transaction, {
          principalUid: linkedMembership.principalUid,
          householdId: linkedMembership.householdId,
          memberId: linkedMembership.memberId,
          displayName: member.displayName,
          memberAggregateVersion: memberVersion,
          capabilities: linkedMembership.capabilities,
          createdAtIso: this.input.requestedAt,
        });
      }
    }

    for (const invitationState of state.invitations) {
      const reference = this.database
        .collection("householdInvitations")
        .doc(invitationState.invitationHash);
      const fields = {
        invitationHash: invitationState.invitationHash,
        householdId: invitationState.householdId,
        expiresAt: Timestamp.fromDate(new Date(invitationState.expiresAt)),
        status: invitationState.status,
        ...(invitationState.usedByUid === undefined
          ? {}
          : {
              usedByUid: invitationState.usedByUid,
              usedAt: Timestamp.fromDate(new Date(this.input.requestedAt)),
            }),
        aggregateVersion: invitationState.status === "used" ? 2 : 1,
        schemaVersion: ACCESS_SCHEMA_VERSION,
        updatedAt: FieldValue.serverTimestamp(),
        ...(loaded.invitationSnapshot?.exists === true
          ? {}
          : { createdAt: FieldValue.serverTimestamp() }),
      };
      if (loaded.invitationSnapshot?.exists === true) {
        transaction.set(reference, fields, { merge: true });
      } else {
        transaction.create(reference, fields);
      }
    }

    for (const event of state.events) {
      const aggregateId =
        event.eventType === "HouseholdCreated.v1"
          ? event.householdId
          : typeof event.payload.memberId === "string"
            ? event.payload.memberId
            : event.householdId;
      const creatorMemberId = state.members.find(
        (member) => member.householdId === event.householdId,
      )?.memberId;
      outbox.append(transaction, {
        eventId: accessEventId(this.input.commandId, event.eventType, aggregateId),
        eventType:
          event.eventType === "HouseholdCreated.v1"
            ? "HouseholdCreated.v1"
            : "MemberJoined.v1",
        householdId: event.householdId,
        aggregateId,
        aggregateVersion: 1,
        occurredAt: this.input.requestedAt,
        correlationId: this.input.commandId,
        causationId: this.input.commandId,
        payload:
          event.eventType === "HouseholdCreated.v1"
            ? {
                householdId: event.householdId,
                creatorMemberId: creatorMemberId ?? "unknown",
                initializationVersion: 1,
              }
            : { householdId: event.householdId, ...event.payload },
      });
    }
  }
}
