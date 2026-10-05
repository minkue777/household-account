import {
  createLegacyMembershipApplication,
  type LegacyMembershipUseCases,
} from "../../src/contexts/access/legacy-membership/application/legacyMembershipApplication";
import type {
  LegacyMemberOwnerProfileIdPort,
  LegacyMembershipMutation,
  LegacyMembershipResolutionRead,
  LegacyMembershipStorePort,
} from "../../src/contexts/access/legacy-membership/application/ports/out/legacyMembershipStorePort";
import type { LegacyMembershipState } from "../../src/contexts/access/legacy-membership/domain/model/legacyMembership";
import { captureLegacyCandidate } from "../../src/contexts/access/legacy-membership/domain/policies/legacyMembershipPolicy";
import type {
  CapturedLegacyCandidate,
  LegacyMembershipMigrationInputPort,
  LegacyMembershipView,
} from "../../src/contexts/access/public";

export interface LegacyMigrationFixture {
  webLocalStorage?: Readonly<Record<string, string>>;
  androidNativeMirror?: Readonly<Record<string, string>>;
  households?: readonly {
    householdId: string;
    legacyHouseholdKey: string;
    lifecycleState: "active" | "deleted";
  }[];
  members?: readonly {
    householdId: string;
    memberId: string;
    displayName: string;
    linkedPrincipalUid?: string;
  }[];
  memberships?: readonly LegacyMembershipView[];
  repositoryAvailability?: "available" | "temporarily-unavailable";
}

export interface LegacyMigrationSnapshot {
  webLocalStorage: Readonly<Record<string, string>>;
  memberships: readonly LegacyMembershipView[];
  members: readonly {
    householdId: string;
    memberId: string;
    displayName: string;
    linkedPrincipalUid?: string;
  }[];
  memberOwnerProfiles: readonly {
    householdId: string;
    profileId: string;
    linkedMemberId: string;
    lifecycleState: "active";
  }[];
  auditEvents: readonly {
    eventType: string;
    householdId: string;
    memberId: string;
  }[];
}

export interface LegacyMembershipMigrationFixtureSubject
  extends LegacyMembershipMigrationInputPort {
  snapshot(): Promise<LegacyMigrationSnapshot>;
}

function cloneState(state: LegacyMembershipState): LegacyMembershipState {
  return {
    households: state.households.map((household) => ({ ...household })),
    members: state.members.map((member) => ({ ...member })),
    memberships: state.memberships.map((membership) => ({ ...membership })),
    memberOwnerProfiles: state.memberOwnerProfiles.map((profile) => ({
      ...profile,
    })),
    auditEvents: state.auditEvents.map((event) => ({ ...event })),
  };
}

class FixtureLegacyMembershipStore implements LegacyMembershipStorePort {
  private stateValue: LegacyMembershipState;
  private serial: Promise<void> = Promise.resolve();

  constructor(
    fixture: LegacyMigrationFixture,
    private readonly availability:
      | "available"
      | "temporarily-unavailable",
  ) {
    const members = (fixture.members ?? []).map((member) => ({ ...member }));
    this.stateValue = {
      households: (fixture.households ?? []).map((household) => ({
        ...household,
      })),
      members,
      memberships: (fixture.memberships ?? []).map((membership) => ({
        ...membership,
      })),
      memberOwnerProfiles: members
        .filter((member) => member.linkedPrincipalUid !== undefined)
        .map((member) => ({
          householdId: member.householdId,
          profileId: `profile-member-${member.memberId}`,
          linkedMemberId: member.memberId,
          lifecycleState: "active" as const,
        })),
      auditEvents: [],
    };
  }

  async read(): Promise<LegacyMembershipState> {
    await this.serial;
    return cloneState(this.stateValue);
  }

  async readForResolution(): Promise<LegacyMembershipResolutionRead> {
    await this.serial;
    return this.availability === "temporarily-unavailable"
      ? {
          kind: "retryable-failure",
          code: "MEMBERSHIP_LOOKUP_UNAVAILABLE",
        }
      : { kind: "success", state: cloneState(this.stateValue) };
  }

  async transact<T>(
    operation: (current: LegacyMembershipState) => LegacyMembershipMutation<T>,
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

class FixtureLegacyMemberProfileIds implements LegacyMemberOwnerProfileIdPort {
  profileIdForMember(_householdId: string, memberId: string): string {
    return `profile-member-${memberId}`;
  }
}

class FixtureLegacyMigrationDriver
  implements LegacyMembershipMigrationFixtureSubject
{
  private webLocalStorage: Record<string, string>;

  constructor(
    private readonly application: LegacyMembershipUseCases,
    private readonly store: FixtureLegacyMembershipStore,
    fixture: LegacyMigrationFixture,
  ) {
    this.webLocalStorage = { ...(fixture.webLocalStorage ?? {}) };
  }

  captureLegacySessionCandidate(): CapturedLegacyCandidate {
    return captureLegacyCandidate(this.webLocalStorage);
  }

  resolveSignedInUser(principalUid: string) {
    const captured = this.captureLegacySessionCandidate();
    return this.application.resolveSignedInUser(
      principalUid,
      captured.kind === "complete" ? captured.candidate : undefined,
    );
  }

  claimLegacySession(
    input: Parameters<LegacyMembershipMigrationInputPort["claimLegacySession"]>[0],
  ) {
    return this.application.claimLegacySession(input);
  }

  repairLegacyMembershipClaim(
    ...args: Parameters<
      LegacyMembershipMigrationInputPort["repairLegacyMembershipClaim"]
    >
  ) {
    return this.application.repairLegacyMembershipClaim(...args);
  }

  async snapshot(): Promise<LegacyMigrationSnapshot> {
    const state = await this.store.read();
    return {
      webLocalStorage: { ...this.webLocalStorage },
      memberships: state.memberships.map((membership) => ({ ...membership })),
      members: state.members.map((member) => ({ ...member })),
      memberOwnerProfiles: state.memberOwnerProfiles.map((profile) => ({
        ...profile,
      })),
      auditEvents: state.auditEvents.map((event) => ({ ...event })),
    };
  }
}

export function createLegacyMembershipMigrationFixtureSubject(
  fixture: LegacyMigrationFixture,
): LegacyMembershipMigrationFixtureSubject {
  const store = new FixtureLegacyMembershipStore(
    fixture,
    fixture.repositoryAvailability ?? "available",
  );
  const application = createLegacyMembershipApplication({
    store,
    profileIds: new FixtureLegacyMemberProfileIds(),
  });
  return new FixtureLegacyMigrationDriver(
    application,
    store,
    fixture,
  );
}
