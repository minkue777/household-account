import type * as firestore from "firebase-admin/firestore";

import { FirebaseAssetOwnerProfileStore } from "../../adapters/firebase/access/firebaseAssetOwnerProfileStore";
import {
  dependentOwnerProfileId,
  issueInvitationCode,
  memberOwnerProfileId,
  sha256,
  stableAccessId,
  stableHouseholdId,
} from "../../adapters/firebase/access/firebaseAccessPersistence";
import { FirebaseGoogleOnboardingStore } from "../../adapters/firebase/access/firebaseGoogleOnboardingStore";
import { FirebaseLegacyMembershipStore } from "../../adapters/firebase/access/firebaseLegacyMembershipStore";
import { legacyMembershipClaimEnabled } from "../../adapters/firebase/access/legacyMembershipClaimConfiguration";
import { FirebaseMemberRenameStore } from "../../adapters/firebase/access/firebaseMemberRenameStore";
import { FirebaseCategoryCatalogStore } from "../../adapters/firebase/categories/firebaseCategoryCatalogStore";
import { createAssetOwnerProfileApplication } from "../../contexts/access/asset-owner-profile/application/assetOwnerProfileApplication";
import { createGoogleOnboardingApplication } from "../../contexts/access/google-onboarding/application/googleOnboardingApplication";
import { GoogleOnboardingPayloadConflict } from "../../contexts/access/google-onboarding/application/ports/out/googleOnboardingStorePort";
import { createLegacyMembershipApplication } from "../../contexts/access/legacy-membership/application/legacyMembershipApplication";
import { createMemberRenameApplication } from "../../contexts/access/member-rename/application/memberRenameApplication";
import { createCategoryCatalogApplication } from "../../contexts/household-finance/categories-budget/application/categoryCatalogApplication";
import {
  HouseholdCommandRejection,
  type HouseholdCommandExecutionContext,
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

function defaultCategoryInitializer(
  database: firestore.Firestore,
  context: HouseholdCommandExecutionContext,
) {
  return {
    async initialize(householdId: string) {
      const commandId = stableAccessId("initialize-default-categories", householdId);
      const store = new FirebaseCategoryCatalogStore(database, {
        requireActiveHousehold: true,
        householdId,
        principalUid: context.principalUid,
        commandId,
        payloadFingerprint: payloadFingerprint(
          "initialize-default-categories",
          householdId,
        ),
        requestedAt: context.requestedAt,
      });
      const application = createCategoryCatalogApplication({
        store,
        ids: {
          nextCategoryId: (commandKey) =>
            stableAccessId("category", context.principalUid, commandKey),
          archiveProcessId: (commandKey) =>
            stableAccessId("category-archive", context.principalUid, commandKey),
        },
        referenceRemapper: {
          async remapRecurringReferences() {
            return {
              kind: "retryable-failure" as const,
              code: "INITIALIZATION_ONLY",
            };
          },
          async remapMerchantRuleReferences() {
            return {
              kind: "retryable-failure" as const,
              code: "INITIALIZATION_ONLY",
            };
          },
        },
      });

      try {
        const result = await application.initializeDefaults(commandId);
        return result.kind === "success" || result.kind === "already-processed"
          ? "completed" as const
          : "failed" as const;
      } catch {
        return "failed" as const;
      }
    },
  };
}

export function createAccessHouseholdCommandHandlers(
  database: firestore.Firestore,
): ReadonlyMap<string, HouseholdCommandHandler> {
  return new Map([
    [
      "access.claim-legacy-membership.v1",
      {
        async execute(context) {
          if (!legacyMembershipClaimEnabled()) throw new HouseholdCommandRejection("LEGACY_CLAIM_DISABLED");
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
        idempotencyBoundary: "domain-idempotency-key",
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
          const householdId = stableHouseholdId(
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
            // 신규 가구가 첫 원장 명령을 즉시 사용할 수 있도록 기본 카탈로그를
            // 같은 onboarding 흐름에서 생성합니다. initializeDefaults는 별도
            // receipt를 가지므로 command 재시도와 향후 outbox 재처리에도 안전합니다.
            initializer: defaultCategoryInitializer(database, context),
          });
          const result = await application.createHouseholdWithSelf(
            { uid: context.principalUid },
            {
              householdName,
              selfDisplayName: memberName,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          ).catch((error: unknown) => {
            if (error instanceof GoogleOnboardingPayloadConflict) {
              throw new HouseholdCommandRejection("IDEMPOTENCY_PAYLOAD_MISMATCH");
            }
            throw error;
          });
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
      "access.retry-household-initialization.v1",
      {
        idempotencyBoundary: "domain-idempotency-key",
        async execute(context) {
          if (context.actor === undefined) throw new HouseholdCommandRejection("HOUSEHOLD_REQUIRED");
          const payload = payloadRecord(context.envelope.payload);
          if (Object.keys(payload).length !== 0) throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          const household = database.collection("households").doc(context.actor.householdId);
          const data = (await household.get()).data();
          if (!data || (data.lifecycleState ?? "active") !== "active" || data.deletedAt != null) {
            throw new HouseholdCommandRejection("HOUSEHOLD_NOT_ACTIVE");
          }
          // 구형 가구는 별도 초기화 상태가 없으며 기존 카탈로그를 보존합니다.
          if (data.initializationStatus == null || data.initializationStatus === "completed") {
            return { initializationStatus: "completed" };
          }
          const observedStatus = await defaultCategoryInitializer(database, context)
            .initialize(context.actor.householdId);
          return database.runTransaction(async transaction => {
            const current = (await transaction.get(household)).data();
            if (!current || (current.lifecycleState ?? "active") !== "active" || current.deletedAt != null) {
              throw new HouseholdCommandRejection("HOUSEHOLD_NOT_ACTIVE");
            }
            const initializationStatus = current.initializationStatus === "completed" ? "completed" : observedStatus;
            if (current.initializationStatus !== initializationStatus) transaction.update(household, { initializationStatus });
            return { initializationStatus };
          });
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
              {
                principalUid: context.principalUid,
                memberId: context.actor.actingMemberId,
                idempotencyKey: context.envelope.idempotencyKey,
              },
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
