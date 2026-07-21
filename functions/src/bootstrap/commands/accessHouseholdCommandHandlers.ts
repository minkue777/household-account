import type * as firestore from "firebase-admin/firestore";

import { FirebaseAssetOwnerProfileStore } from "../../adapters/firebase/access/firebaseAssetOwnerProfileStore";
import {
  dependentOwnerProfileId,
  issueInvitationCode,
  memberOwnerProfileId,
  sha256,
  stableAccessId,
} from "../../adapters/firebase/access/firebaseAccessPersistence";
import { FirebaseGoogleOnboardingStore } from "../../adapters/firebase/access/firebaseGoogleOnboardingStore";
import { FirebaseHouseholdLifecycleUnitOfWork } from "../../adapters/firebase/access/firebaseHouseholdLifecycleUnitOfWork";
import { FirebaseLegacyMembershipStore } from "../../adapters/firebase/access/firebaseLegacyMembershipStore";
import { FirebaseMemberRenameStore } from "../../adapters/firebase/access/firebaseMemberRenameStore";
import { createAssetOwnerProfileApplication } from "../../contexts/access/asset-owner-profile/application/assetOwnerProfileApplication";
import { createGoogleOnboardingApplication } from "../../contexts/access/google-onboarding/application/googleOnboardingApplication";
import { createHouseholdLifecycleApplication } from "../../contexts/access/household-lifecycle/application/householdLifecycleApplication";
import { createLegacyMembershipApplication } from "../../contexts/access/legacy-membership/application/legacyMembershipApplication";
import { createMemberRenameApplication } from "../../contexts/access/member-rename/application/memberRenameApplication";
import {
  HouseholdCommandRejection,
  type HouseholdCommandHandler,
  withHouseholdCommandReceiptValue,
} from "./householdCommand";

function payloadRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string") throw new HouseholdCommandRejection(code);
  return value;
}

function requiredNumber(value: unknown, code: string): number {
  if (typeof value !== "number") throw new HouseholdCommandRejection(code);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function payloadFingerprint(...values: readonly unknown[]): string {
  return sha256(JSON.stringify(values));
}

function rejectDomainResult(result: { readonly code?: string }, fallback: string): never {
  throw new HouseholdCommandRejection(result.code ?? fallback, false);
}

export function createAccessHouseholdCommandHandlers(
  database: firestore.Firestore,
): ReadonlyMap<string, HouseholdCommandHandler> {
  return new Map([
    [
      "access.claim-legacy-membership.v1",
      {
        async execute(context) {
          const payload = payloadRecord(context.envelope.payload);
          const householdKey = requiredString(
            payload.legacyHouseholdId,
            "LEGACY_HOUSEHOLD_ID_REQUIRED",
          ).trim();
          const memberId = requiredString(
            payload.legacyMemberId,
            "LEGACY_MEMBER_ID_REQUIRED",
          ).trim();
          const presentedMemberName = optionalString(payload.legacyMemberName);
          const application = createLegacyMembershipApplication({
            store: new FirebaseLegacyMembershipStore(database, {
              principalUid: context.principalUid,
              householdKey,
              memberId,
              ...(presentedMemberName === undefined
                ? {}
                : { presentedMemberName }),
              idempotencyKey: context.envelope.idempotencyKey,
              payloadFingerprint: payloadFingerprint(
                "claim-legacy-membership",
                householdKey,
                memberId,
                presentedMemberName ?? null,
              ),
              requestedAt: context.requestedAt,
              commandId: context.envelope.commandId,
            }),
            profileIds: { profileIdForMember: memberOwnerProfileId },
          });
          const result = await application.claimLegacySession({
            principalUid: context.principalUid,
            candidate: {
              householdKey,
              currentMemberId: memberId,
              ...(presentedMemberName === undefined
                ? {}
                : { currentMemberName: presentedMemberName }),
            },
            userConfirmed: true,
            idempotencyKey: context.envelope.idempotencyKey,
          });
          if ("membership" in result) {
            return {
              householdId: result.membership.householdId,
              memberId: result.membership.memberId,
            };
          }
          if (result.kind === "first-visit-required") {
            throw new HouseholdCommandRejection("LEGACY_MEMBERSHIP_NOT_FOUND");
          }
          throw new HouseholdCommandRejection(result.code, false);
        },
      },
    ],
    [
      "access.create-household-with-self.v1",
      {
        async execute(context) {
          const payload = payloadRecord(context.envelope.payload);
          const householdName = requiredString(
            payload.householdName,
            "HOUSEHOLD_NAME_REQUIRED",
          );
          const memberName = requiredString(
            payload.memberName,
            "SELF_DISPLAY_NAME_REQUIRED",
          );
          const householdId = stableAccessId(
            "household",
            context.principalUid,
            context.envelope.idempotencyKey,
          );
          const memberId = stableAccessId(
            "member",
            context.principalUid,
            context.envelope.idempotencyKey,
          );
          const application = createGoogleOnboardingApplication({
            store: new FirebaseGoogleOnboardingStore(database, {
              principalUid: context.principalUid,
              idempotencyKey: context.envelope.idempotencyKey,
              payloadFingerprint: payloadFingerprint(
                "create-household-with-self",
                householdName.trim(),
                memberName.trim(),
              ),
              requestedAt: context.requestedAt,
              commandId: context.envelope.commandId,
              mode: { kind: "create", householdId, memberId },
            }),
            clock: { now: () => context.requestedAt },
            identities: {
              nextHouseholdId: () => householdId,
              nextMemberId: () => memberId,
            },
            invitations: {
              issueCode: issueInvitationCode,
              hashCode: sha256,
            },
            // HouseholdCreated outbox consumer가 각 Context 초기화를 수행합니다.
            initializer: { initialize: async () => "pending" },
          });
          const result = await application.createHouseholdWithSelf(
            { uid: context.principalUid },
            {
              householdName,
              selfDisplayName: memberName,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          if (result.kind === "success") {
            return {
              householdId: result.householdId,
              memberId: result.memberId,
              initializationStatus: result.initializationStatus,
            };
          }
          return rejectDomainResult(result, "HOUSEHOLD_CREATE_FAILED");
        },
      },
    ],
    [
      "access.join-household-as-self.v1",
      {
        async execute(context) {
          const payload = payloadRecord(context.envelope.payload);
          const invitationCode = requiredString(
            payload.invitationCode,
            "INVITATION_CODE_REQUIRED",
          );
          const memberName = requiredString(
            payload.memberName,
            "SELF_DISPLAY_NAME_REQUIRED",
          );
          const memberId = stableAccessId(
            "member",
            context.principalUid,
            context.envelope.idempotencyKey,
          );
          const invitationHash = sha256(invitationCode.trim());
          const application = createGoogleOnboardingApplication({
            store: new FirebaseGoogleOnboardingStore(database, {
              principalUid: context.principalUid,
              idempotencyKey: context.envelope.idempotencyKey,
              payloadFingerprint: payloadFingerprint(
                "join-household-as-self",
                invitationHash,
                memberName.trim(),
              ),
              requestedAt: context.requestedAt,
              commandId: context.envelope.commandId,
              mode: { kind: "join", invitationHash, memberId },
            }),
            clock: { now: () => context.requestedAt },
            identities: {
              nextHouseholdId: () => "unused-household-id",
              nextMemberId: () => memberId,
            },
            invitations: {
              issueCode: issueInvitationCode,
              hashCode: sha256,
            },
            initializer: { initialize: async () => "pending" },
          });
          const result = await application.joinHouseholdAsSelf(
            { uid: context.principalUid },
            {
              invitationCode,
              selfDisplayName: memberName,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          if (result.kind === "success") {
            return { householdId: result.householdId, memberId: result.memberId };
          }
          return rejectDomainResult(result, "HOUSEHOLD_JOIN_FAILED");
        },
      },
    ],
    [
      "access.create-invitation.v1",
      {
        async execute(context) {
          if (context.actor === undefined) {
            throw new HouseholdCommandRejection("INVITATION_ISSUE_FORBIDDEN");
          }
          payloadRecord(context.envelope.payload);
          const application = createGoogleOnboardingApplication({
            store: new FirebaseGoogleOnboardingStore(database, {
              principalUid: context.principalUid,
              idempotencyKey: context.envelope.idempotencyKey,
              payloadFingerprint: payloadFingerprint(
                "create-invitation",
                context.actor.householdId,
              ),
              requestedAt: context.requestedAt,
              commandId: context.envelope.commandId,
              mode: {
                kind: "issue-invitation",
                householdId: context.actor.householdId,
              },
            }),
            clock: { now: () => context.requestedAt },
            identities: {
              nextHouseholdId: () => "unused-household-id",
              nextMemberId: () => "unused-member-id",
            },
            invitations: {
              issueCode: issueInvitationCode,
              hashCode: sha256,
            },
            initializer: { initialize: async () => "pending" },
          });
          const result = await application.createInvitationCode(
            { uid: context.principalUid },
            {
              householdId: context.actor.householdId,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          if (result.kind === "success") {
            return withHouseholdCommandReceiptValue(
              {
                invitationCode: result.invitationCode,
                expiresAt: result.expiresAt,
              },
              {
                kind: "invitation-already-issued",
                expiresAt: result.expiresAt,
              },
            );
          }
          return rejectDomainResult(result, "INVITATION_ISSUE_FAILED");
        },
      },
    ],
    [
      "access.create-asset-owner-profile.v1",
      {
        async execute(context) {
          if (context.actor === undefined) {
            throw new HouseholdCommandRejection("PROFILE_WRITE_FORBIDDEN");
          }
          const payload = payloadRecord(context.envelope.payload);
          const displayName = requiredString(
            payload.displayName,
            "ASSET_OWNER_PROFILE_NAME_REQUIRED",
          );
          const application = createAssetOwnerProfileApplication({
            store: new FirebaseAssetOwnerProfileStore(database, {
              householdId: context.actor.householdId,
              principalUid: context.actor.principalUid,
              idempotencyKey: context.envelope.idempotencyKey,
              payloadFingerprint: payloadFingerprint(
                "create-asset-owner-profile",
                context.actor.householdId,
                displayName.trim(),
              ),
              requestedAt: context.requestedAt,
              commandId: context.envelope.commandId,
            }),
            ids: {
              nextDependentProfileId: (idempotencyKey) =>
                dependentOwnerProfileId(
                  context.actor?.householdId ?? "missing-household",
                  idempotencyKey,
                ),
            },
          });
          const profileCapabilities = context.actor.capabilities.filter(
            (
              capability,
            ): capability is
              | "household.asset-owner-profile.write"
              | "admin.asset-owner-profile.archive" =>
              capability === "household.asset-owner-profile.write" ||
              capability === "admin.asset-owner-profile.archive",
          );
          const result = await application.createAssetOwnerProfile(
            {
              principalUid: context.actor.principalUid,
              householdId: context.actor.householdId,
              actingMemberId: context.actor.actingMemberId,
              capabilities: profileCapabilities,
            },
            {
              displayName,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          if (result.kind === "success") return result.profile;
          if (result.kind === "not-found") {
            throw new HouseholdCommandRejection("ASSET_OWNER_PROFILE_NOT_FOUND");
          }
          return rejectDomainResult(result, "ASSET_OWNER_PROFILE_CREATE_FAILED");
        },
      },
    ],
    [
      "access.rename-asset-owner-profile.v1",
      {
        async execute(context) {
          if (context.actor === undefined) {
            throw new HouseholdCommandRejection("PROFILE_WRITE_FORBIDDEN");
          }
          const payload = payloadRecord(context.envelope.payload);
          const profileId = requiredString(
            payload.profileId,
            "ASSET_OWNER_PROFILE_ID_REQUIRED",
          ).trim();
          const displayName = requiredString(
            payload.displayName,
            "ASSET_OWNER_PROFILE_NAME_REQUIRED",
          );
          const expectedVersion = requiredNumber(
            payload.expectedVersion,
            "EXPECTED_VERSION_REQUIRED",
          );
          const application = createAssetOwnerProfileApplication({
            store: new FirebaseAssetOwnerProfileStore(database, {
              householdId: context.actor.householdId,
              principalUid: context.actor.principalUid,
              idempotencyKey: context.envelope.idempotencyKey,
              payloadFingerprint: payloadFingerprint(
                "rename-asset-owner-profile",
                context.actor.householdId,
                profileId,
                displayName.trim(),
                expectedVersion,
              ),
              requestedAt: context.requestedAt,
              commandId: context.envelope.commandId,
            }),
            ids: {
              nextDependentProfileId: () => "unused-profile-id",
            },
          });
          const result = await application.renameAssetOwnerProfile(
            {
              principalUid: context.actor.principalUid,
              householdId: context.actor.householdId,
              actingMemberId: context.actor.actingMemberId,
              capabilities: context.actor.capabilities.filter(
                (capability): capability is "household.asset-owner-profile.write" =>
                  capability === "household.asset-owner-profile.write",
              ),
            },
            {
              profileId,
              displayName,
              expectedVersion,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          if (result.kind === "success") return result.profile;
          if (result.kind === "not-found") {
            throw new HouseholdCommandRejection("ASSET_OWNER_PROFILE_NOT_FOUND");
          }
          return rejectDomainResult(result, "ASSET_OWNER_PROFILE_RENAME_FAILED");
        },
      },
    ],
    [
      "access.archive-asset-owner-profile.v1",
      {
        async execute(context) {
          if (context.administrator === undefined) {
            throw new HouseholdCommandRejection("PROFILE_ARCHIVE_FORBIDDEN");
          }
          const householdId = requiredString(
            context.envelope.householdId,
            "HOUSEHOLD_ID_REQUIRED",
          ).trim();
          const payload = payloadRecord(context.envelope.payload);
          const profileId = requiredString(
            payload.profileId,
            "ASSET_OWNER_PROFILE_ID_REQUIRED",
          ).trim();
          const expectedVersion = requiredNumber(
            payload.expectedVersion,
            "EXPECTED_VERSION_REQUIRED",
          );
          const application = createAssetOwnerProfileApplication({
            store: new FirebaseAssetOwnerProfileStore(database, {
              householdId,
              principalUid: context.administrator.principalRef,
              idempotencyKey: context.envelope.idempotencyKey,
              payloadFingerprint: payloadFingerprint(
                "archive-asset-owner-profile",
                householdId,
                profileId,
                expectedVersion,
              ),
              requestedAt: context.requestedAt,
              commandId: context.envelope.commandId,
            }),
            ids: {
              nextDependentProfileId: () => "unused-profile-id",
            },
          });
          const result = await application.archiveAssetOwnerProfile(
            {
              principalUid: context.administrator.principalRef,
              householdId,
              capabilities: context.administrator.capabilities.filter(
                (capability): capability is "admin.asset-owner-profile.archive" =>
                  capability === "admin.asset-owner-profile.archive",
              ),
            },
            {
              profileId,
              expectedVersion,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          if (result.kind === "success") return result.profile;
          if (result.kind === "not-found") {
            throw new HouseholdCommandRejection("ASSET_OWNER_PROFILE_NOT_FOUND");
          }
          return rejectDomainResult(result, "ASSET_OWNER_PROFILE_ARCHIVE_FAILED");
        },
      },
    ],
    [
      "access.request-household-deletion.v1",
      {
        async execute(context) {
          if (context.actor === undefined) {
            throw new HouseholdCommandRejection("HOUSEHOLD_DELETE_REQUIRED");
          }
          const payload = payloadRecord(context.envelope.payload);
          const reason = optionalString(payload.reason) ?? "user-requested";
          let expectedVersion = payload.expectedVersion;
          if (expectedVersion === undefined) {
            const household = await database
              .collection("households")
              .doc(context.actor.householdId)
              .get();
            if (!household.exists) {
              throw new HouseholdCommandRejection("HOUSEHOLD_NOT_FOUND");
            }
            expectedVersion =
              typeof household.data()?.aggregateVersion === "number"
                ? household.data()?.aggregateVersion
                : 1;
          }
          const validatedVersion = requiredNumber(
            expectedVersion,
            "EXPECTED_VERSION_REQUIRED",
          );
          const application = createHouseholdLifecycleApplication({
            unitOfWork: new FirebaseHouseholdLifecycleUnitOfWork(database, {
              householdId: context.actor.householdId,
              principalUid: context.actor.principalUid,
              idempotencyKey: context.envelope.idempotencyKey,
              requestedAt: context.requestedAt,
              commandId: context.envelope.commandId,
            }),
            clock: { now: () => context.requestedAt },
            identities: {
              nextPurgeProcessId: (idempotencyKey) =>
                stableAccessId("purge", context.actor?.householdId ?? "", idempotencyKey),
            },
            hash: { hashSensitiveReference: sha256 },
          });
          const lifecycleCapabilities = context.actor.capabilities.filter(
            (
              capability,
            ): capability is
              | "household.delete"
              | "household.restore"
              | "household.purge.permanent"
              | "household.purge.read" =>
              capability === "household.delete" ||
              capability === "household.restore" ||
              capability === "household.purge.permanent" ||
              capability === "household.purge.read",
          );
          const result = await application.requestHouseholdDeletion(
            {
              principalRef: context.actor.principalUid,
              capabilities: lifecycleCapabilities,
            },
            {
              householdId: context.actor.householdId,
              reason,
              expectedVersion: validatedVersion,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          if (result.kind === "success" || result.kind === "already-processed") {
            return {};
          }
          return rejectDomainResult(result, "HOUSEHOLD_DELETE_FAILED");
        },
      },
    ],
    [
      "access.rename-self.v1",
      {
        async execute(context) {
          if (context.actor === undefined) {
            throw new HouseholdCommandRejection("RENAME_SELF_FORBIDDEN");
          }
          const payload = payloadRecord(context.envelope.payload);
          const application = createMemberRenameApplication({
            store: new FirebaseMemberRenameStore(
              database,
              context.actor.householdId,
              context.requestedAt,
              context.envelope.commandId,
            ),
          });
          const result = await application.renameSelf(
            {
              principalUid: context.actor.principalUid,
              householdId: context.actor.householdId,
              actingMemberId: context.actor.actingMemberId,
            },
            {
              displayName: requiredString(
                payload.displayName,
                "DISPLAY_NAME_REQUIRED",
              ),
              expectedVersion: requiredNumber(
                payload.expectedVersion,
                "EXPECTED_VERSION_REQUIRED",
              ),
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          if (result.kind === "success") return result.member;
          throw new HouseholdCommandRejection(
            result.code,
            false,
          );
        },
      },
    ],
  ]);
}
