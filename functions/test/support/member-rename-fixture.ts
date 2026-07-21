import { createMemberRenameApplication } from "../../src/contexts/access/member-rename/application/memberRenameApplication";
import type {
  MemberRenameMutation,
  MemberRenameStorePort,
} from "../../src/contexts/access/member-rename/application/ports/out/memberRenameStorePort";
import type {
  MemberRenamedEvent,
  MemberRenameState,
} from "../../src/contexts/access/member-rename/domain/model/memberRename";
import type { MemberRenameInputPort } from "../../src/contexts/access/public";

export interface MemberRenameFixture {
  householdId: string;
  members: readonly {
    principalUid: string;
    memberId: string;
    displayName: string;
    aggregateVersion: number;
  }[];
  stableReferences: Readonly<{
    transactions: readonly string[];
    assets: readonly string[];
    registeredCards: readonly string[];
    notificationEndpoints: readonly string[];
  }>;
}

export interface MemberRenameSnapshot {
  members: readonly {
    memberId: string;
    displayName: string;
    aggregateVersion: number;
  }[];
  memberOwnerProfiles: readonly {
    profileId: string;
    linkedMemberId: string;
    displayName: string;
  }[];
  stableReferences: MemberRenameFixture["stableReferences"];
}

export interface MemberRenameFixtureSubject extends MemberRenameInputPort {
  snapshot(): Promise<MemberRenameSnapshot>;
  publishedEvents(): Promise<readonly MemberRenamedEvent[]>;
}

function cloneState(state: MemberRenameState): MemberRenameState {
  return {
    householdId: state.householdId,
    members: state.members.map((member) => ({ ...member })),
    memberships: state.memberships.map((membership) => ({ ...membership })),
    memberOwnerProfiles: state.memberOwnerProfiles.map((profile) => ({ ...profile })),
    receipts: state.receipts.map((receipt) => ({
      ...receipt,
      result: {
        ...receipt.result,
        member: { ...receipt.result.member },
      },
    })),
    events: state.events.map((event) => ({ ...event })),
  };
}

class FixtureMemberRenameStore implements MemberRenameStorePort {
  private stateValue: MemberRenameState;
  private serial: Promise<void> = Promise.resolve();

  constructor(fixture: MemberRenameFixture) {
    this.stateValue = {
      householdId: fixture.householdId,
      members: fixture.members.map((member) => ({ ...member })),
      memberships: fixture.members.map((member) => ({
        principalUid: member.principalUid,
        memberId: member.memberId,
        status: "active" as const,
      })),
      memberOwnerProfiles: fixture.members.map((member) => ({
        profileId: `profile-${member.memberId}`,
        linkedMemberId: member.memberId,
        displayName: member.displayName,
      })),
      receipts: [],
      events: [],
    };
  }

  async read(): Promise<MemberRenameState> {
    await this.serial;
    return cloneState(this.stateValue);
  }

  async transact<T>(
    operation: (state: MemberRenameState) => MemberRenameMutation<T>,
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

class FixtureMemberRenameDriver implements MemberRenameFixtureSubject {
  private readonly stableReferences: MemberRenameFixture["stableReferences"];

  constructor(
    private readonly application: MemberRenameInputPort,
    private readonly store: FixtureMemberRenameStore,
    fixture: MemberRenameFixture,
  ) {
    this.stableReferences = {
      transactions: [...fixture.stableReferences.transactions],
      assets: [...fixture.stableReferences.assets],
      registeredCards: [...fixture.stableReferences.registeredCards],
      notificationEndpoints: [...fixture.stableReferences.notificationEndpoints],
    };
  }

  renameSelf(...args: Parameters<MemberRenameInputPort["renameSelf"]>) {
    return this.application.renameSelf(...args);
  }

  async snapshot(): Promise<MemberRenameSnapshot> {
    const state = await this.store.read();
    return {
      members: state.members.map(({ memberId, displayName, aggregateVersion }) => ({
        memberId,
        displayName,
        aggregateVersion,
      })),
      memberOwnerProfiles: state.memberOwnerProfiles.map((profile) => ({ ...profile })),
      stableReferences: {
        transactions: [...this.stableReferences.transactions],
        assets: [...this.stableReferences.assets],
        registeredCards: [...this.stableReferences.registeredCards],
        notificationEndpoints: [...this.stableReferences.notificationEndpoints],
      },
    };
  }

  async publishedEvents(): Promise<readonly MemberRenamedEvent[]> {
    return (await this.store.read()).events.map((event) => ({ ...event }));
  }
}

export function createMemberRenameFixtureSubject(
  fixture: MemberRenameFixture,
): MemberRenameFixtureSubject {
  const store = new FixtureMemberRenameStore(fixture);
  return new FixtureMemberRenameDriver(
    createMemberRenameApplication({ store }),
    store,
    fixture,
  );
}
