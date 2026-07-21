import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  AssetOwnerProfileMutation,
  AssetOwnerProfileStorePort,
} from "../../../contexts/access/asset-owner-profile/application/ports/out/assetOwnerProfileStorePort";
import type {
  AssetOwnerProfile,
  AssetOwnerProfileState,
} from "../../../contexts/access/asset-owner-profile/domain/model/assetOwnerProfile";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import {
  ACCESS_SCHEMA_VERSION,
  accessEventId,
  accessReceiptReference,
  isoString,
  numberField,
  stringField,
  terminalReceiptFields,
} from "./firebaseAccessPersistence";

export interface FirebaseAssetOwnerProfileStoreInput {
  readonly householdId: string;
  readonly principalUid: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly requestedAt: string;
  readonly commandId: string;
}

interface LoadedProfileState {
  readonly state: AssetOwnerProfileState;
  readonly profilesById: ReadonlyMap<string, AssetOwnerProfile>;
}

function mapProfile(
  householdId: string,
  snapshot: firestore.QueryDocumentSnapshot,
): AssetOwnerProfile | undefined {
  const data = snapshot.data();
  const displayName = stringField(data, "displayName");
  const profileType = stringField(data, "profileType");
  const lifecycleState = stringField(data, "lifecycleState") ?? "active";
  if (
    displayName === undefined ||
    (profileType !== "member" && profileType !== "dependent") ||
    (lifecycleState !== "active" && lifecycleState !== "archived")
  ) {
    return undefined;
  }
  const linkedMemberId = stringField(data, "linkedMemberId");
  const createdAt = isoString(data.createdAt);
  return {
    profileId: snapshot.id,
    householdId,
    displayName,
    profileType,
    ...(linkedMemberId === undefined ? {} : { linkedMemberId }),
    ...(createdAt === undefined ? {} : { createdAt }),
    lifecycleState,
    aggregateVersion: numberField(data, "aggregateVersion", 1),
  };
}

export class FirebaseAssetOwnerProfileStore
  implements AssetOwnerProfileStorePort
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly input: FirebaseAssetOwnerProfileStoreInput,
  ) {}

  private async load(
    transaction: firestore.Transaction,
  ): Promise<LoadedProfileState> {
    const householdReference = this.database
      .collection("households")
      .doc(this.input.householdId);
    const [profiles, members, memberships] = await Promise.all([
      transaction.get(householdReference.collection("assetOwnerProfiles")),
      transaction.get(householdReference.collection("members")),
      transaction.get(householdReference.collection("memberships")),
    ]);
    return {
      state: {
        householdId: this.input.householdId,
        profiles: profiles.docs.flatMap((snapshot) => {
          const mapped = mapProfile(this.input.householdId, snapshot);
          return mapped === undefined ? [] : [mapped];
        }),
        members: members.docs.flatMap((snapshot) => {
          const data = snapshot.data();
          const principalUid = stringField(data, "linkedPrincipalUid");
          const displayName = stringField(data, "displayName");
          if (principalUid === undefined || displayName === undefined) return [];
          return [
            {
              principalUid,
              memberId: snapshot.id,
              displayName,
              profileId:
                stringField(data, "profileId") ?? `profile-member-${snapshot.id}`,
              aggregateVersion: numberField(data, "aggregateVersion", 1),
            },
          ];
        }),
        memberships: memberships.docs.flatMap((snapshot) => {
          const data = snapshot.data();
          const memberId = stringField(data, "memberId");
          const status =
            stringField(data, "lifecycleState") ??
            stringField(data, "status") ??
            "active";
          return memberId === undefined || status !== "active"
            ? []
            : [
                {
                  principalUid: snapshot.id,
                  memberId,
                  householdId: this.input.householdId,
                  status: "active" as const,
                },
              ];
        }),
        events: [],
      },
      profilesById: new Map(
        profiles.docs.flatMap((snapshot) => {
          const mapped = mapProfile(this.input.householdId, snapshot);
          return mapped === undefined ? [] : [[snapshot.id, mapped] as const];
        }),
      ),
    };
  }

  async read(): Promise<AssetOwnerProfileState> {
    return this.database.runTransaction(async (transaction) =>
      (await this.load(transaction)).state,
    );
  }

  async transact<T>(
    operation: (current: AssetOwnerProfileState) => AssetOwnerProfileMutation<T>,
  ): Promise<T> {
    const receiptReference = accessReceiptReference(
      this.database,
      "access-asset-owner-profile",
      this.input.principalUid,
      this.input.idempotencyKey,
    );
    return this.database.runTransaction(async (transaction) => {
      const receipt = await transaction.get(receiptReference);
      if (receipt.exists) {
        if (receipt.data()?.payloadFingerprint !== this.input.payloadFingerprint) {
          throw new Error("Asset owner profile idempotency payload mismatch");
        }
        return receipt.data()?.result as T;
      }

      const loaded = await this.load(transaction);
      const mutation = operation(loaded.state);
      for (const profile of mutation.state.profiles) {
        const reference = this.database
          .collection("households")
          .doc(this.input.householdId)
          .collection("assetOwnerProfiles")
          .doc(profile.profileId);
        const fields = {
          householdId: profile.householdId,
          profileId: profile.profileId,
          displayName: profile.displayName,
          profileType: profile.profileType,
          lifecycleState: profile.lifecycleState,
          aggregateVersion: profile.aggregateVersion,
          schemaVersion: ACCESS_SCHEMA_VERSION,
          updatedAt: FieldValue.serverTimestamp(),
        };
        const previous = loaded.profilesById.get(profile.profileId);
        if (previous === undefined) {
          transaction.create(reference, {
            ...fields,
            createdAt: FieldValue.serverTimestamp(),
          });
        } else if (
          previous.displayName !== profile.displayName ||
          previous.lifecycleState !== profile.lifecycleState ||
          previous.aggregateVersion !== profile.aggregateVersion
        ) {
          transaction.set(reference, fields, { merge: true });
        }
      }

      for (const event of mutation.state.events) {
        const profile = mutation.state.profiles.find(
          (candidate) => candidate.profileId === event.payload.profileId,
        );
        new FirebaseTransactionalOutbox(this.database).append(transaction, {
          eventId: accessEventId(
            this.input.commandId,
            "AssetOwnerProfileChanged.v1",
            event.payload.profileId,
          ),
          eventType: "AssetOwnerProfileChanged.v1",
          householdId: event.householdId,
          aggregateId: event.payload.profileId,
          aggregateVersion: profile?.aggregateVersion ?? 1,
          occurredAt: this.input.requestedAt,
          correlationId: this.input.commandId,
          causationId: this.input.commandId,
          payload: { householdId: event.householdId, ...event.payload },
        });
      }

      transaction.create(
        receiptReference,
        terminalReceiptFields({
          principalUid: this.input.principalUid,
          householdId: this.input.householdId,
          payloadFingerprint: this.input.payloadFingerprint,
          result: mutation.value,
          completedAt: this.input.requestedAt,
        }),
      );
      return mutation.value;
    });
  }
}
