import { createMemberLifecycleApplication } from "../../src/contexts/access/member-lifecycle/application/memberLifecycleApplication";
import type {
  MemberLifecycleMutation,
  MemberLifecycleUnitOfWorkPort,
} from "../../src/contexts/access/member-lifecycle/application/ports/out/memberLifecycleUnitOfWorkPort";
import type {
  HouseholdMemberLifecycleEvent,
  MemberLifecycleAggregate,
} from "../../src/contexts/access/member-lifecycle/domain/model/memberLifecycle";
import type { MemberLifecycleInputPort } from "../../src/contexts/access/public";

export type MemberLifecycleFixtureKind =
  | "two-members"
  | "last-member"
  | "removed-member";

export type JoinOtherHouseholdResult =
  | { kind: "success"; householdId: string; memberId: string }
  | { kind: "conflict"; code: string };

export interface MemberRemovalSnapshot {
  household: MemberLifecycleAggregate["household"];
  members: readonly Omit<
    MemberLifecycleAggregate["members"][number],
    "principalUid"
  >[];
  memberships: MemberLifecycleAggregate["memberships"];
  memberOwnerProfiles: MemberLifecycleAggregate["memberOwnerProfiles"];
  principalClaims: MemberLifecycleAggregate["principalClaims"];
  activeRecipientMemberIds: readonly string[];
  businessDataDigest: Readonly<Record<string, string>>;
  notificationEndpointIds: readonly string[];
}

export interface MemberRemovalRestorationFixtureSubject
  extends MemberLifecycleInputPort {
  joinAnotherHousehold(
    principalUid: string,
    householdId: string,
    idempotencyKey: string,
  ): Promise<JoinOtherHouseholdResult>;
  snapshot(): Promise<MemberRemovalSnapshot>;
  publishedEvents(): Promise<readonly HouseholdMemberLifecycleEvent[]>;
}

function cloneAggregate(
  state: MemberLifecycleAggregate,
): MemberLifecycleAggregate {
  return {
    household: { ...state.household },
    members: state.members.map((member) => ({ ...member })),
    memberships: state.memberships.map((membership) => ({ ...membership })),
    memberOwnerProfiles: state.memberOwnerProfiles.map((profile) => ({ ...profile })),
    principalClaims: state.principalClaims.map((claim) => ({ ...claim })),
    receipts: state.receipts.map((receipt) => ({
      ...receipt,
      result: { ...receipt.result },
    })),
    events: state.events.map((event) => ({ ...event })),
  };
}

function activeMember(
  principalUid: string,
  memberId: string,
  origin: "creator" | "invitee",
) {
  return {
    member: {
      principalUid,
      memberId,
      origin,
      status: "active" as const,
      version: 3,
    },
    membership: {
      principalUid,
      householdId: "house-1",
      memberId,
      status: "active" as const,
      version: 3,
    },
    profile: {
      profileId: `profile-${memberId}`,
      linkedMemberId: memberId,
      lifecycleState: "active" as const,
    },
    claim: { principalUid, householdId: "house-1", memberId },
  };
}

function fixtureAggregate(kind: MemberLifecycleFixtureKind): MemberLifecycleAggregate {
  if (kind === "removed-member") {
    return {
      household: { householdId: "house-1", lifecycleState: "active" },
      members: [
        {
          principalUid: "uid-removed",
          memberId: "member-removed",
          origin: "invitee",
          status: "removed",
          version: 4,
        },
      ],
      memberships: [
        {
          principalUid: "uid-removed",
          householdId: "house-1",
          memberId: "member-removed",
          status: "removed",
          version: 4,
        },
      ],
      memberOwnerProfiles: [
        {
          profileId: "profile-member-removed",
          linkedMemberId: "member-removed",
          lifecycleState: "archived",
        },
      ],
      principalClaims: [],
      receipts: [],
      events: [],
    };
  }

  const entries =
    kind === "last-member"
      ? [activeMember("uid-last", "member-last", "creator")]
      : [
          activeMember("uid-creator", "member-creator", "creator"),
          activeMember("uid-invitee", "member-invitee", "invitee"),
        ];
  return {
    household: { householdId: "house-1", lifecycleState: "active" },
    members: entries.map(({ member }) => member),
    memberships: entries.map(({ membership }) => membership),
    memberOwnerProfiles: entries.map(({ profile }) => profile),
    principalClaims: entries.map(({ claim }) => claim),
    receipts: [],
    events: [],
  };
}

class FixtureMemberLifecycleUnitOfWork
  implements MemberLifecycleUnitOfWorkPort
{
  private stateValue: MemberLifecycleAggregate;
  private serial: Promise<void> = Promise.resolve();

  constructor(kind: MemberLifecycleFixtureKind) {
    this.stateValue = fixtureAggregate(kind);
  }

  async read(): Promise<MemberLifecycleAggregate> {
    await this.serial;
    return cloneAggregate(this.stateValue);
  }

  async transact<T>(
    operation: (
      state: MemberLifecycleAggregate,
    ) => MemberLifecycleMutation<T>,
  ): Promise<T> {
    const transaction = this.serial.then(() => {
      const mutation = operation(cloneAggregate(this.stateValue));
      this.stateValue = cloneAggregate(mutation.state);
      return mutation.value;
    });
    this.serial = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }

  claimAnotherHousehold(
    principalUid: string,
    householdId: string,
  ): Promise<JoinOtherHouseholdResult> {
    return this.transact<JoinOtherHouseholdResult>((state) => {
      if (
        state.principalClaims.some(
          (claim) => claim.principalUid === principalUid,
        )
      ) {
        return {
          state,
          value: { kind: "conflict", code: "PRINCIPAL_ALREADY_JOINED" },
        };
      }
      const memberId = `member-${householdId}-${principalUid}`;
      return {
        state: {
          ...state,
          principalClaims: [
            ...state.principalClaims,
            { principalUid, householdId, memberId },
          ],
        },
        value: { kind: "success", householdId, memberId },
      };
    });
  }
}

class MemberRemovalRestorationFixtureDriver
  implements MemberRemovalRestorationFixtureSubject
{
  private readonly businessDataDigest = {
    transactions: "transactions:stable-member-id-references",
    assets: "assets:stable-member-id-references",
    registeredCards: "cards:stable-member-id-references",
  } as const;
  private readonly notificationEndpointIds: readonly string[];

  constructor(
    private readonly application: MemberLifecycleInputPort,
    private readonly unitOfWork: FixtureMemberLifecycleUnitOfWork,
    kind: MemberLifecycleFixtureKind,
  ) {
    this.notificationEndpointIds =
      kind === "removed-member"
        ? []
        : kind === "last-member"
          ? ["endpoint-last"]
          : ["endpoint-creator", "endpoint-invitee"];
  }

  removeHouseholdMember(...args: Parameters<MemberLifecycleInputPort["removeHouseholdMember"]>) {
    return this.application.removeHouseholdMember(...args);
  }

  restoreRemovedHouseholdMember(...args: Parameters<MemberLifecycleInputPort["restoreRemovedHouseholdMember"]>) {
    return this.application.restoreRemovedHouseholdMember(...args);
  }

  authorizeMember(...args: Parameters<MemberLifecycleInputPort["authorizeMember"]>) {
    return this.application.authorizeMember(...args);
  }

  joinAnotherHousehold(
    principalUid: string,
    householdId: string,
    _idempotencyKey: string,
  ): Promise<JoinOtherHouseholdResult> {
    return this.unitOfWork.claimAnotherHousehold(principalUid, householdId);
  }

  async snapshot(): Promise<MemberRemovalSnapshot> {
    const state = await this.unitOfWork.read();
    return {
      household: { ...state.household },
      members: state.members.map(
        ({ memberId, origin, status, version }) => ({
          memberId,
          origin,
          status,
          version,
        }),
      ),
      memberships: state.memberships.map((membership) => ({ ...membership })),
      memberOwnerProfiles: state.memberOwnerProfiles.map((profile) => ({ ...profile })),
      principalClaims: state.principalClaims.map((claim) => ({ ...claim })),
      activeRecipientMemberIds: state.memberships
        .filter((membership) => membership.status === "active")
        .map((membership) => membership.memberId),
      businessDataDigest: { ...this.businessDataDigest },
      notificationEndpointIds: [...this.notificationEndpointIds],
    };
  }

  async publishedEvents(): Promise<readonly HouseholdMemberLifecycleEvent[]> {
    return (await this.unitOfWork.read()).events.map((event) => ({ ...event }));
  }
}

export function createMemberRemovalRestorationFixtureSubject(
  kind: MemberLifecycleFixtureKind = "two-members",
): MemberRemovalRestorationFixtureSubject {
  const unitOfWork = new FixtureMemberLifecycleUnitOfWork(kind);
  return new MemberRemovalRestorationFixtureDriver(
    createMemberLifecycleApplication({ unitOfWork }),
    unitOfWork,
    kind,
  );
}
