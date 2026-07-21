import {
  AssetOwnerProfileCommandResult,
  AssetOwnerProfileInputPort,
  AssetOwnerProfileListResult,
  AssetOwnerProfileView,
  RenameSelfResult,
  VerifiedProfileActor,
} from "./ports/in/assetOwnerProfileInputPort";
import {
  AssetOwnerProfileIdPort,
  AssetOwnerProfileStorePort,
} from "./ports/out/assetOwnerProfileStorePort";
import {
  AssetOwnerProfile,
  AssetOwnerProfileState,
} from "../domain/model/assetOwnerProfile";
import {
  memberHasSingleProfile,
  profileChangedEvent,
  validateProfileName,
} from "../domain/policies/assetOwnerProfilePolicy";

export interface AssetOwnerProfileApplicationDependencies {
  store: AssetOwnerProfileStorePort;
  ids: AssetOwnerProfileIdPort;
}

function toView(profile: AssetOwnerProfile): AssetOwnerProfileView {
  return {
    profileId: profile.profileId,
    householdId: profile.householdId,
    displayName: profile.displayName,
    profileType: profile.profileType,
    ...(profile.linkedMemberId === undefined
      ? {}
      : { linkedMemberId: profile.linkedMemberId }),
    lifecycleState: profile.lifecycleState,
    aggregateVersion: profile.aggregateVersion,
  };
}

function compareByEntryOrder(
  left: AssetOwnerProfile,
  right: AssetOwnerProfile,
): number {
  if (left.createdAt !== undefined && right.createdAt !== undefined) {
    return left.createdAt.localeCompare(right.createdAt);
  }
  if (left.createdAt !== undefined) return -1;
  if (right.createdAt !== undefined) return 1;
  // createdAt이 없는 레거시·테스트 상태는 stable sort의 기존 배열 순서를 유지합니다.
  return 0;
}

function hasCapability(
  actor: VerifiedProfileActor,
  capability:
    | "household.asset-owner-profile.write"
    | "admin.asset-owner-profile.archive",
): boolean {
  return actor.capabilities.includes(capability);
}

function isActiveMember(
  state: AssetOwnerProfileState,
  actor: VerifiedProfileActor,
): boolean {
  return (
    actor.householdId === state.householdId &&
    actor.actingMemberId !== undefined &&
    state.memberships.some(
      (membership) =>
        membership.householdId === state.householdId &&
        membership.principalUid === actor.principalUid &&
        membership.memberId === actor.actingMemberId &&
        membership.status === "active",
    )
  );
}

function canWriteProfile(
  state: AssetOwnerProfileState,
  actor: VerifiedProfileActor,
): boolean {
  return (
    isActiveMember(state, actor) &&
    hasCapability(actor, "household.asset-owner-profile.write")
  );
}

class DefaultAssetOwnerProfileApplication
  implements AssetOwnerProfileInputPort
{
  constructor(private readonly dependencies: AssetOwnerProfileApplicationDependencies) {}

  async createAssetOwnerProfile(
    actor: VerifiedProfileActor,
    input: { displayName: string; idempotencyKey: string },
  ): Promise<AssetOwnerProfileCommandResult> {
    const name = validateProfileName(input.displayName);
    if (name.kind === "invalid") {
      return { kind: "validation-error", code: name.code };
    }

    return this.dependencies.store.transact<AssetOwnerProfileCommandResult>(
      (current) => {
        if (!canWriteProfile(current, actor)) {
          return {
            state: current,
            value: { kind: "forbidden", code: "PROFILE_WRITE_FORBIDDEN" },
          };
        }

        const profile: AssetOwnerProfile = {
          profileId: this.dependencies.ids.nextDependentProfileId(
            input.idempotencyKey,
          ),
          householdId: current.householdId,
          displayName: name.displayName,
          profileType: "dependent",
          lifecycleState: "active",
          aggregateVersion: 1,
        };
        return {
          state: {
            ...current,
            profiles: [...current.profiles, profile],
            events: [...current.events, profileChangedEvent(profile, true)],
          },
          value: { kind: "success", profile: toView(profile) },
        };
      },
    );
  }

  async renameAssetOwnerProfile(
    actor: VerifiedProfileActor,
    input: {
      profileId: string;
      displayName: string;
      expectedVersion: number;
      idempotencyKey: string;
    },
  ): Promise<AssetOwnerProfileCommandResult> {
    const name = validateProfileName(input.displayName);
    if (name.kind === "invalid") {
      return { kind: "validation-error", code: name.code };
    }

    return this.dependencies.store.transact<AssetOwnerProfileCommandResult>(
      (current) => {
        if (!canWriteProfile(current, actor)) {
          return {
            state: current,
            value: { kind: "forbidden", code: "PROFILE_WRITE_FORBIDDEN" },
          };
        }
        const profile = current.profiles.find(
          (candidate) => candidate.profileId === input.profileId,
        );
        if (profile === undefined || profile.householdId !== actor.householdId) {
          return {
            state: current,
            value: {
              kind: "not-found",
              resource: "AssetOwnerProfile",
              id: input.profileId,
            },
          };
        }
        if (profile.profileType === "member") {
          return {
            state: current,
            value: { kind: "conflict", code: "MEMBER_PROFILE_IMMUTABLE" },
          };
        }
        if (profile.lifecycleState === "archived") {
          return {
            state: current,
            value: { kind: "conflict", code: "OWNER_PROFILE_ARCHIVED" },
          };
        }
        if (profile.aggregateVersion !== input.expectedVersion) {
          return {
            state: current,
            value: {
              kind: "conflict",
              code: "OWNER_PROFILE_VERSION_MISMATCH",
              currentVersion: profile.aggregateVersion,
            },
          };
        }

        const renamed: AssetOwnerProfile = {
          ...profile,
          displayName: name.displayName,
          aggregateVersion: profile.aggregateVersion + 1,
        };
        return {
          state: {
            ...current,
            profiles: current.profiles.map((candidate) =>
              candidate.profileId === renamed.profileId ? renamed : candidate,
            ),
            events: [...current.events, profileChangedEvent(renamed, true)],
          },
          value: { kind: "success", profile: toView(renamed) },
        };
      },
    );
  }

  async archiveAssetOwnerProfile(
    actor: VerifiedProfileActor,
    input: {
      profileId: string;
      expectedVersion: number;
      idempotencyKey: string;
    },
  ): Promise<AssetOwnerProfileCommandResult> {
    return this.dependencies.store.transact<AssetOwnerProfileCommandResult>(
      (current) => {
        if (
          actor.householdId !== current.householdId ||
          !hasCapability(actor, "admin.asset-owner-profile.archive")
        ) {
          return {
            state: current,
            value: { kind: "forbidden", code: "PROFILE_ARCHIVE_FORBIDDEN" },
          };
        }
        const profile = current.profiles.find(
          (candidate) => candidate.profileId === input.profileId,
        );
        if (profile === undefined) {
          return {
            state: current,
            value: {
              kind: "not-found",
              resource: "AssetOwnerProfile",
              id: input.profileId,
            },
          };
        }
        if (profile.profileType === "member") {
          return {
            state: current,
            value: { kind: "conflict", code: "MEMBER_PROFILE_IMMUTABLE" },
          };
        }
        if (profile.lifecycleState === "archived") {
          return {
            state: current,
            value: { kind: "conflict", code: "OWNER_PROFILE_ARCHIVED" },
          };
        }
        if (profile.aggregateVersion !== input.expectedVersion) {
          return {
            state: current,
            value: {
              kind: "conflict",
              code: "OWNER_PROFILE_VERSION_MISMATCH",
              currentVersion: profile.aggregateVersion,
            },
          };
        }

        const archived: AssetOwnerProfile = {
          ...profile,
          lifecycleState: "archived",
          aggregateVersion: profile.aggregateVersion + 1,
        };
        return {
          state: {
            ...current,
            profiles: current.profiles.map((candidate) =>
              candidate.profileId === archived.profileId ? archived : candidate,
            ),
            events: [...current.events, profileChangedEvent(archived, false)],
          },
          value: { kind: "success", profile: toView(archived) },
        };
      },
    );
  }

  async renameSelf(
    actor: VerifiedProfileActor,
    input: {
      displayName: string;
      expectedMemberVersion: number;
      idempotencyKey: string;
    },
  ): Promise<RenameSelfResult> {
    const name = validateProfileName(input.displayName);
    if (name.kind === "invalid") {
      return { kind: "validation-error", code: name.code };
    }

    return this.dependencies.store.transact<RenameSelfResult>((current) => {
      if (!canWriteProfile(current, actor)) {
        return {
          state: current,
          value: { kind: "forbidden", code: "RENAME_SELF_FORBIDDEN" },
        };
      }
      const member = current.members.find(
        (candidate) =>
          candidate.memberId === actor.actingMemberId &&
          candidate.principalUid === actor.principalUid,
      );
      if (member === undefined || !memberHasSingleProfile(current, member.memberId)) {
        return {
          state: current,
          value: { kind: "conflict", code: "MEMBER_PROFILE_INVARIANT_BROKEN" },
        };
      }
      if (member.aggregateVersion !== input.expectedMemberVersion) {
        return {
          state: current,
          value: { kind: "conflict", code: "MEMBER_VERSION_MISMATCH" },
        };
      }

      const memberProfile = current.profiles.find(
        (profile) =>
          profile.profileType === "member" &&
          profile.linkedMemberId === member.memberId,
      );
      if (memberProfile === undefined) {
        return {
          state: current,
          value: { kind: "conflict", code: "MEMBER_PROFILE_INVARIANT_BROKEN" },
        };
      }
      const renamedProfile: AssetOwnerProfile = {
        ...memberProfile,
        displayName: name.displayName,
        aggregateVersion: memberProfile.aggregateVersion + 1,
      };

      return {
        state: {
          ...current,
          members: current.members.map((candidate) =>
            candidate.memberId === member.memberId
              ? {
                  ...candidate,
                  displayName: name.displayName,
                  aggregateVersion: candidate.aggregateVersion + 1,
                }
              : candidate,
          ),
          profiles: current.profiles.map((profile) =>
            profile.profileId === renamedProfile.profileId
              ? renamedProfile
              : profile,
          ),
          events: [
            ...current.events,
            profileChangedEvent(renamedProfile, true),
          ],
        },
        value: {
          kind: "success",
          memberId: member.memberId,
          displayName: name.displayName,
        },
      };
    });
  }

  async listAssetOwnerProfiles(
    actor: VerifiedProfileActor,
    input: { includeArchived?: boolean },
  ): Promise<AssetOwnerProfileListResult> {
    const state = await this.dependencies.store.read();
    const isAdministrator =
      actor.householdId === state.householdId &&
      hasCapability(actor, "admin.asset-owner-profile.archive");
    if (!isActiveMember(state, actor) && !isAdministrator) {
      return { kind: "forbidden", code: "PROFILE_READ_FORBIDDEN" };
    }
    const profiles = state.profiles
      .filter(
        (profile) =>
          profile.householdId === actor.householdId &&
          (input.includeArchived === true ||
            profile.lifecycleState === "active"),
      )
      .slice()
      .sort(compareByEntryOrder)
      .map(toView);
    return profiles.length === 0
      ? { kind: "no-data" }
      : { kind: "success", profiles };
  }

  async resolveOwnerProfileForHistory(
    actor: VerifiedProfileActor,
    profileId: string,
  ): Promise<AssetOwnerProfileView | undefined> {
    const state = await this.dependencies.store.read();
    if (!isActiveMember(state, actor)) {
      return undefined;
    }
    const profile = state.profiles.find(
      (candidate) =>
        candidate.householdId === actor.householdId &&
        candidate.profileId === profileId,
    );
    return profile === undefined ? undefined : toView(profile);
  }
}

export function createAssetOwnerProfileApplication(
  dependencies: AssetOwnerProfileApplicationDependencies,
): AssetOwnerProfileInputPort {
  return new DefaultAssetOwnerProfileApplication(dependencies);
}
