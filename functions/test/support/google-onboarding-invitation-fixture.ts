import { createGoogleOnboardingApplication } from "../../src/contexts/access/google-onboarding/application/googleOnboardingApplication";
import type {
  GoogleOnboardingClockPort,
  GoogleOnboardingIdentityPort,
  GoogleOnboardingMutation,
  GoogleOnboardingStorePort,
  HouseholdInitializationPort,
  InvitationSecurityPort,
} from "../../src/contexts/access/google-onboarding/application/ports/out/googleOnboardingStorePort";
import type {
  GoogleOnboardingState,
  OnboardingAccessEvent,
} from "../../src/contexts/access/google-onboarding/domain/model/googleOnboarding";
import type { GoogleOnboardingInputPort } from "../../src/contexts/access/public";

export interface GoogleOnboardingFixture {
  initializationOutcome?: "pending" | "completed" | "failed";
}

export interface OnboardingSnapshot {
  households: readonly {
    householdId: string;
    lifecycleState: "active";
  }[];
  members: readonly {
    householdId: string;
    memberId: string;
    linkedPrincipalUid: string;
    displayName: string;
  }[];
  memberships: readonly {
    principalUid: string;
    householdId: string;
    memberId: string;
    status: "active";
    capabilities: readonly string[];
  }[];
  principalClaims: readonly {
    principalUid: string;
    householdId: string;
    memberId: string;
    version: number;
  }[];
  initializations: readonly {
    householdId: string;
    status: "pending" | "completed" | "failed";
  }[];
  invitations: readonly {
    householdId: string;
    expiresAt: string;
    status: "issued" | "used";
    usedByUid?: string;
  }[];
}

export type PublicAccessEvent = OnboardingAccessEvent;

export interface GoogleOnboardingFixtureSubject extends GoogleOnboardingInputPort {
  setCurrentTime(instant: string): void;
  snapshot(): Promise<OnboardingSnapshot>;
  publishedEvents(): Promise<readonly PublicAccessEvent[]>;
}

function cloneState(state: GoogleOnboardingState): GoogleOnboardingState {
  return {
    households: state.households.map((household) => ({ ...household })),
    members: state.members.map((member) => ({ ...member })),
    memberships: state.memberships.map((membership) => ({
      ...membership,
      capabilities: [...membership.capabilities],
    })),
    principalClaims: state.principalClaims.map((claim) => ({ ...claim })),
    initializations: state.initializations.map((initialization) => ({
      ...initialization,
    })),
    invitations: state.invitations.map((invitation) => ({ ...invitation })),
    events: state.events.map((event) => ({
      ...event,
      payload: { ...event.payload },
    })),
  };
}

class FixtureGoogleOnboardingStore implements GoogleOnboardingStorePort {
  private stateValue: GoogleOnboardingState = {
    households: [],
    members: [],
    memberships: [],
    principalClaims: [],
    initializations: [],
    invitations: [],
    events: [],
  };
  private serial: Promise<void> = Promise.resolve();

  async read(): Promise<GoogleOnboardingState> {
    await this.serial;
    return cloneState(this.stateValue);
  }

  async transact<T>(
    operation: (current: GoogleOnboardingState) => GoogleOnboardingMutation<T>,
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

class FixtureGoogleOnboardingClock implements GoogleOnboardingClockPort {
  private current = "2026-07-19T09:00:00.000Z";

  now(): string {
    return this.current;
  }

  setCurrentTime(instant: string): void {
    this.current = new Date(instant).toISOString();
  }
}

class FixtureGoogleOnboardingIdentities
  implements GoogleOnboardingIdentityPort
{
  private householdSequence = 1;
  private memberSequence = 1;

  nextHouseholdId(_idempotencyKey: string): string {
    const householdId = `household-${this.householdSequence}`;
    this.householdSequence += 1;
    return householdId;
  }

  nextMemberId(_idempotencyKey: string): string {
    const memberId = `member-${this.memberSequence}`;
    this.memberSequence += 1;
    return memberId;
  }
}

class FixtureInvitationSecurity implements InvitationSecurityPort {
  private sequence = 1;

  issueCode(_idempotencyKey: string): string {
    const code = `INVITE-${this.sequence.toString().padStart(6, "0")}`;
    this.sequence += 1;
    return code;
  }

  hashCode(invitationCode: string): string {
    return `fixture-hash:${invitationCode}`;
  }
}

class FixtureHouseholdInitializer implements HouseholdInitializationPort {
  constructor(
    private readonly outcome: "pending" | "completed" | "failed",
  ) {}

  async initialize(
    _householdId: string,
  ): Promise<"pending" | "completed" | "failed"> {
    return this.outcome;
  }
}

class FixtureGoogleOnboardingDriver implements GoogleOnboardingFixtureSubject {
  constructor(
    private readonly application: GoogleOnboardingInputPort,
    private readonly store: FixtureGoogleOnboardingStore,
    private readonly clock: FixtureGoogleOnboardingClock,
  ) {}

  setCurrentTime(instant: string): void {
    this.clock.setCurrentTime(instant);
  }

  resolveSignedInUser(...args: Parameters<GoogleOnboardingInputPort["resolveSignedInUser"]>) {
    return this.application.resolveSignedInUser(...args);
  }

  createHouseholdWithSelf(...args: Parameters<GoogleOnboardingInputPort["createHouseholdWithSelf"]>) {
    return this.application.createHouseholdWithSelf(...args);
  }

  createInvitationCode(...args: Parameters<GoogleOnboardingInputPort["createInvitationCode"]>) {
    return this.application.createInvitationCode(...args);
  }

  joinHouseholdAsSelf(...args: Parameters<GoogleOnboardingInputPort["joinHouseholdAsSelf"]>) {
    return this.application.joinHouseholdAsSelf(...args);
  }

  async snapshot(): Promise<OnboardingSnapshot> {
    const state = await this.store.read();
    return {
      households: state.households.map(({ householdId, lifecycleState }) => ({
        householdId,
        lifecycleState,
      })),
      members: state.members.map((member) => ({ ...member })),
      memberships: state.memberships.map((membership) => ({
        ...membership,
        capabilities: [...membership.capabilities],
      })),
      principalClaims: state.principalClaims.map((claim) => ({ ...claim })),
      initializations: state.initializations.map((initialization) => ({
        ...initialization,
      })),
      invitations: state.invitations.map(
        ({ householdId, expiresAt, status, usedByUid }) => ({
          householdId,
          expiresAt,
          status,
          ...(usedByUid === undefined ? {} : { usedByUid }),
        }),
      ),
    };
  }

  async publishedEvents(): Promise<readonly PublicAccessEvent[]> {
    return (await this.store.read()).events.map((event) => ({
      ...event,
      payload: { ...event.payload },
    }));
  }
}

export function createGoogleOnboardingFixtureSubject(
  fixture: GoogleOnboardingFixture = {},
): GoogleOnboardingFixtureSubject {
  const store = new FixtureGoogleOnboardingStore();
  const clock = new FixtureGoogleOnboardingClock();
  const application = createGoogleOnboardingApplication({
    store,
    clock,
    identities: new FixtureGoogleOnboardingIdentities(),
    invitations: new FixtureInvitationSecurity(),
    initializer: new FixtureHouseholdInitializer(
      fixture.initializationOutcome ?? "completed",
    ),
  });
  return new FixtureGoogleOnboardingDriver(application, store, clock);
}
