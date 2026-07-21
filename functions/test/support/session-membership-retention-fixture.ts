import { createSessionMembershipApplication } from "../../src/contexts/access/session-membership/application/sessionMembershipApplication";
import type {
  SessionEndpointPort,
  SessionMembershipMutation,
  SessionMembershipStorePort,
} from "../../src/contexts/access/session-membership/application/ports/out/sessionMembershipPorts";
import type { SessionMembershipState } from "../../src/contexts/access/session-membership/domain/model/sessionMembership";
import type {
  LogoutSessionResult,
  RestoreSessionResult,
  SessionEndpointRegistrationResult,
  SessionEndpointRemovalResult,
  SessionMembershipInputPort,
  SessionScopeView,
  VerifiedSessionPrincipal,
} from "../../src/contexts/access/public";

export interface MembershipRetentionSnapshot {
  householdState: "active" | "deleted";
  member: {
    memberId: string;
    displayName: string;
    status: "active";
  };
  membership: {
    principalUid: string;
    householdId: string;
    memberId: string;
    status: "active";
  };
  session?: SessionScopeView;
  bridgeMirror?: {
    householdId: string;
    memberId: string;
    sessionGeneration: number;
  };
  notificationSync: "not-requested" | "registered" | "retryable-failure";
}

export interface MembershipRetentionFixtureSubject {
  supportedAccessCommands(): readonly string[];
  logoutHouseholdSession(
    endpointOutcome: SessionEndpointRemovalResult,
  ): Promise<LogoutSessionResult>;
  restoreSignedInSession(
    principalUid: string,
    endpointOutcome: SessionEndpointRegistrationResult,
  ): Promise<RestoreSessionResult>;
  setHouseholdStateForTest(state: "active" | "deleted"): void;
  deliverLateSessionCallback(generation: number, displayName: string): void;
  snapshot(): Promise<MembershipRetentionSnapshot>;
  publishedEvents(): Promise<readonly { eventType: string }[]>;
}

function cloneState(state: SessionMembershipState): SessionMembershipState {
  return {
    household: { ...state.household },
    member: { ...state.member },
    membership: { ...state.membership },
    ...(state.session === undefined ? {} : { session: { ...state.session } }),
    ...(state.bridgeMirror === undefined
      ? {}
      : { bridgeMirror: { ...state.bridgeMirror } }),
    lastSessionGeneration: state.lastSessionGeneration,
    notificationSync: state.notificationSync,
  };
}

class FixtureSessionMembershipStore implements SessionMembershipStorePort {
  private stateValue: SessionMembershipState = {
    household: { householdId: "house-1", lifecycleState: "active" },
    member: { memberId: "member-min", displayName: "민규", status: "active" },
    membership: {
      principalUid: "uid-min",
      householdId: "house-1",
      memberId: "member-min",
      status: "active",
    },
    session: {
      schemaVersion: "session-scope.v1",
      sessionGeneration: 1,
      principalUid: "uid-min",
      householdId: "house-1",
      actingMemberId: "member-min",
      displayName: "민규",
    },
    bridgeMirror: {
      householdId: "house-1",
      memberId: "member-min",
      sessionGeneration: 1,
    },
    lastSessionGeneration: 1,
    notificationSync: "registered",
  };
  private serial: Promise<void> = Promise.resolve();

  async read(): Promise<SessionMembershipState> {
    await this.serial;
    return cloneState(this.stateValue);
  }

  async transact<T>(
    operation: (
      state: SessionMembershipState,
    ) => SessionMembershipMutation<T>,
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

  setHouseholdState(state: "active" | "deleted"): void {
    this.stateValue = {
      ...this.stateValue,
      household: { ...this.stateValue.household, lifecycleState: state },
    };
  }

  deliverLateCallback(generation: number, displayName: string): void {
    if (this.stateValue.session?.sessionGeneration !== generation) {
      return;
    }
    this.stateValue = {
      ...this.stateValue,
      session: { ...this.stateValue.session, displayName },
    };
  }
}

class FixtureSessionEndpointPort implements SessionEndpointPort {
  private removalOutcome: SessionEndpointRemovalResult = { kind: "removed" };
  private registrationOutcome: SessionEndpointRegistrationResult = {
    kind: "registered",
    endpointId: "endpoint-default",
  };

  setRemovalOutcome(outcome: SessionEndpointRemovalResult): void {
    this.removalOutcome = outcome;
  }

  setRegistrationOutcome(outcome: SessionEndpointRegistrationResult): void {
    this.registrationOutcome = outcome;
  }

  async removeCurrentInstallationEndpoint(
    _session: SessionScopeView,
  ): Promise<SessionEndpointRemovalResult> {
    return this.removalOutcome;
  }

  async registerCurrentInstallationEndpoint(
    _session: SessionScopeView,
  ): Promise<SessionEndpointRegistrationResult> {
    return this.registrationOutcome;
  }
}

class FixtureMembershipRetentionDriver
  implements MembershipRetentionFixtureSubject
{
  constructor(
    private readonly application: SessionMembershipInputPort,
    private readonly store: FixtureSessionMembershipStore,
    private readonly endpoints: FixtureSessionEndpointPort,
  ) {}

  supportedAccessCommands(): readonly string[] {
    return this.application.supportedAccessCommands();
  }

  logoutHouseholdSession(
    endpointOutcome: SessionEndpointRemovalResult,
  ): Promise<LogoutSessionResult> {
    this.endpoints.setRemovalOutcome(endpointOutcome);
    return this.application.logoutHouseholdSession();
  }

  restoreSignedInSession(
    principalUid: string,
    endpointOutcome: SessionEndpointRegistrationResult,
  ): Promise<RestoreSessionResult> {
    this.endpoints.setRegistrationOutcome(endpointOutcome);
    const principal: VerifiedSessionPrincipal = { principalUid };
    return this.application.restoreSignedInSession(principal);
  }

  setHouseholdStateForTest(state: "active" | "deleted"): void {
    this.store.setHouseholdState(state);
  }

  deliverLateSessionCallback(generation: number, displayName: string): void {
    this.store.deliverLateCallback(generation, displayName);
  }

  async snapshot(): Promise<MembershipRetentionSnapshot> {
    const state = await this.store.read();
    return {
      householdState: state.household.lifecycleState,
      member: { ...state.member },
      membership: { ...state.membership },
      ...(state.session === undefined ? {} : { session: { ...state.session } }),
      ...(state.bridgeMirror === undefined
        ? {}
        : { bridgeMirror: { ...state.bridgeMirror } }),
      notificationSync: state.notificationSync,
    };
  }

  async publishedEvents(): Promise<readonly { eventType: string }[]> {
    return [];
  }
}

export function createMembershipRetentionFixtureSubject(): MembershipRetentionFixtureSubject {
  const store = new FixtureSessionMembershipStore();
  const endpoints = new FixtureSessionEndpointPort();
  return new FixtureMembershipRetentionDriver(
    createSessionMembershipApplication({ store, endpoints }),
    store,
    endpoints,
  );
}
