import { createAssetOwnerProfile, renameAssetOwnerProfile, archiveAssetOwnerProfile, listAssetOwnerProfiles } from "../../src/contexts/access/asset-owner-profile/application/assetOwnerProfileApplication";
import type {
  AssetOwnerProfileIdPort,
  AssetOwnerProfileMutation,
  AssetOwnerProfileStorePort,
} from "../../src/contexts/access/asset-owner-profile/application/ports/out/assetOwnerProfileStorePort";
import type {
  AssetOwnerProfileChangedEvent,
  AssetOwnerProfileState,
} from "../../src/contexts/access/asset-owner-profile/domain/model/assetOwnerProfile";
import type {
  AssetOwnerProfileInputPort,
  AssetOwnerProfileView,
} from "../../src/contexts/access/public";

export interface AssetOwnerProfileFixture {
  householdId: string;
  members: readonly {
    principalUid: string;
    memberId: string;
    displayName: string;
    profileId: string;
    aggregateVersion: number;
    enteredAt?: string;
  }[];
  dependentProfiles?: readonly (AssetOwnerProfileView & {
    enteredAt?: string;
  })[];
}

export interface AssetOwnerProfileSnapshot {
  profiles: readonly AssetOwnerProfileView[];
  memberships: readonly {
    principalUid: string;
    memberId: string;
    householdId: string;
    status: "active";
  }[];
}

export type AssetOwnerProfileEvent = AssetOwnerProfileChangedEvent;

export interface AssetOwnerProfileFixtureSubject extends AssetOwnerProfileInputPort {
  snapshot(): Promise<AssetOwnerProfileSnapshot>;
  publishedEvents(): Promise<readonly AssetOwnerProfileEvent[]>;
}

function cloneState(state: AssetOwnerProfileState): AssetOwnerProfileState {
  return {
    householdId: state.householdId,
    profiles: state.profiles.map((profile) => ({ ...profile })),
    memberships: state.memberships.map((membership) => ({ ...membership })),
    events: state.events.map((event) => ({
      ...event,
      payload: { ...event.payload },
    })),
  };
}

class FixtureAssetOwnerProfileStore implements AssetOwnerProfileStorePort {
  private stateValue: AssetOwnerProfileState;
  private serial: Promise<void> = Promise.resolve();

  constructor(fixture: AssetOwnerProfileFixture) {
    this.stateValue = {
      householdId: fixture.householdId,
      profiles: [
        ...fixture.members.map((member) => ({
          profileId: member.profileId,
          householdId: fixture.householdId,
          displayName: member.displayName,
          profileType: "member" as const,
          linkedMemberId: member.memberId,
          ...(member.enteredAt === undefined
            ? {}
            : { createdAt: member.enteredAt }),
          lifecycleState: "active" as const,
          aggregateVersion: member.aggregateVersion,
        })),
        ...(fixture.dependentProfiles ?? [])
          .filter((profile) => profile.profileType === "dependent")
          .map((profile) => ({
            profileId: profile.profileId,
            householdId: profile.householdId,
            displayName: profile.displayName,
            profileType: "dependent" as const,
            ...(profile.enteredAt === undefined
              ? {}
              : { createdAt: profile.enteredAt }),
            lifecycleState: profile.lifecycleState,
            aggregateVersion: profile.aggregateVersion,
          })),
      ],
      memberships: fixture.members.map((member) => ({
        principalUid: member.principalUid,
        memberId: member.memberId,
        householdId: fixture.householdId,
        status: "active" as const,
      })),
      events: [],
    };
  }

  async read(): Promise<AssetOwnerProfileState> {
    await this.serial;
    return cloneState(this.stateValue);
  }

  async transact<T>(
    operation: (
      current: AssetOwnerProfileState,
    ) => AssetOwnerProfileMutation<T>,
  ): Promise<T> {
    const transaction = this.serial.then(() => {
      const mutation = operation(cloneState(this.stateValue));
      this.stateValue = cloneState(mutation.state);
      return mutation.value;
    });
    this.serial = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }
}

class FixtureAssetOwnerProfileIds implements AssetOwnerProfileIdPort {
  private nextId = 1;

  nextDependentProfileId(_idempotencyKey: string): string {
    const profileId = `profile-dependent-${this.nextId}`;
    this.nextId += 1;
    return profileId;
  }
}

class FixtureAssetOwnerProfileDriver
  implements AssetOwnerProfileFixtureSubject
{
  constructor(
    private readonly application: AssetOwnerProfileInputPort,
    private readonly store: FixtureAssetOwnerProfileStore,
  ) {}

  createAssetOwnerProfile(...args: Parameters<AssetOwnerProfileInputPort["createAssetOwnerProfile"]>) {
    return this.application.createAssetOwnerProfile(...args);
  }

  renameAssetOwnerProfile(...args: Parameters<AssetOwnerProfileInputPort["renameAssetOwnerProfile"]>) {
    return this.application.renameAssetOwnerProfile(...args);
  }

  archiveAssetOwnerProfile(...args: Parameters<AssetOwnerProfileInputPort["archiveAssetOwnerProfile"]>) {
    return this.application.archiveAssetOwnerProfile(...args);
  }

  listAssetOwnerProfiles(...args: Parameters<AssetOwnerProfileInputPort["listAssetOwnerProfiles"]>) {
    return this.application.listAssetOwnerProfiles(...args);
  }



  async snapshot(): Promise<AssetOwnerProfileSnapshot> {
    const state = await this.store.read();
    return {
      profiles: state.profiles.map((profile) => ({ ...profile })),
      memberships: state.memberships.map((membership) => ({ ...membership })),
    };
  }

  async publishedEvents(): Promise<readonly AssetOwnerProfileEvent[]> {
    const state = await this.store.read();
    return state.events.map((event) => ({
      ...event,
      payload: { ...event.payload },
    }));
  }
}

export function createAssetOwnerProfileFixtureSubject(
  fixture: AssetOwnerProfileFixture,
): AssetOwnerProfileFixtureSubject {
  const store = new FixtureAssetOwnerProfileStore(fixture);
  const dependencies = { store, ids: new FixtureAssetOwnerProfileIds() };
  const application: AssetOwnerProfileInputPort = {
    createAssetOwnerProfile: (...args) => createAssetOwnerProfile(dependencies, ...args),
    renameAssetOwnerProfile: (...args) => renameAssetOwnerProfile(store, ...args),
    archiveAssetOwnerProfile: (...args) => archiveAssetOwnerProfile(store, ...args),
    listAssetOwnerProfiles: (...args) => listAssetOwnerProfiles(store, ...args),
  };
  return new FixtureAssetOwnerProfileDriver(application, store);
}
