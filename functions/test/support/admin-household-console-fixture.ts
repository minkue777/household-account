import {
  createAdminHouseholdConsoleApplication,
  type AdminHouseholdConsoleUseCases,
} from "../../src/contexts/access/admin-household-console/application/adminHouseholdConsoleApplication";
import type {
  AdminHouseholdClockPort,
  AdminHouseholdIdentityPort,
  AdminHouseholdMutation,
  AdminHouseholdStorePort,
} from "../../src/contexts/access/admin-household-console/application/ports/out/adminHouseholdStorePort";
import type {
  AdminHouseholdEvent,
  AdminHouseholdState,
} from "../../src/contexts/access/admin-household-console/domain/model/adminHousehold";
import type {
  AdminHouseholdConsoleInputPort,
  AdminHouseholdView,
  VerifiedAdminActor,
} from "../../src/contexts/access/public";

export interface AdminConsoleSnapshot {
  households: readonly AdminHouseholdView[];
}

export type AdminConsoleEvent = AdminHouseholdEvent;

export interface AdminHouseholdConsoleFixtureSubject
  extends AdminHouseholdConsoleInputPort {
  snapshot(): Promise<AdminConsoleSnapshot>;
  publishedEvents(): Promise<readonly AdminConsoleEvent[]>;
}

function cloneState(state: AdminHouseholdState): AdminHouseholdState {
  return {
    households: state.households.map((household) => ({ ...household })),
    events: state.events.map((event) => ({ ...event })),
  };
}

class FixtureAdminHouseholdStore implements AdminHouseholdStorePort {
  private stateValue: AdminHouseholdState = {
    households: [
      {
        householdId: "house-newer",
        name: "최근 가계부",
        createdAt: "2026-07-20T01:00:00.000Z",
        lifecycleState: "active",
        aggregateVersion: 2,
        legacyShareKey: "legacy-newer",
      },
      {
        householdId: "house-older",
        name: "이전 가계부",
        createdAt: "2026-07-19T01:00:00.000Z",
        lifecycleState: "active",
        aggregateVersion: 4,
        legacyShareKey: "legacy-older",
      },
      {
        householdId: "house-oldest",
        name: "가장 오래된 가계부",
        createdAt: "2026-07-18T01:00:00.000Z",
        lifecycleState: "active",
        aggregateVersion: 1,
        legacyShareKey: "legacy-oldest",
      },
    ],
    events: [],
  };
  private serial: Promise<void> = Promise.resolve();

  async read(): Promise<AdminHouseholdState> {
    await this.serial;
    return cloneState(this.stateValue);
  }

  async transact<T>(
    operation: (current: AdminHouseholdState) => AdminHouseholdMutation<T>,
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

class FixtureAdminHouseholdIdentity implements AdminHouseholdIdentityPort {
  private nextId = 1;

  nextHouseholdId(_idempotencyKey: string): string {
    const id = `house-admin-created-${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  nextLegacyShareKey(_idempotencyKey: string): string {
    return `legacy-share-${this.nextId}`;
  }
}

class FixtureAdminHouseholdClock implements AdminHouseholdClockPort {
  now(): string {
    return "2026-07-20T02:00:00.000Z";
  }
}

function view(household: AdminHouseholdState["households"][number]): AdminHouseholdView {
  return { ...household };
}

class FixtureAdminHouseholdConsoleController
  implements AdminHouseholdConsoleFixtureSubject
{
  private actor: VerifiedAdminActor | undefined;

  constructor(
    private readonly application: AdminHouseholdConsoleUseCases,
    private readonly store: FixtureAdminHouseholdStore,
  ) {}

  async open(actor: VerifiedAdminActor) {
    const result = await this.application.open(actor);
    this.actor = result.kind === "success" ? actor : undefined;
    return result;
  }

  listHouseholds(input: { cursor?: string; limit: number }) {
    return this.application.listHouseholds(this.actor, input);
  }

  createHousehold(input: { name: string; idempotencyKey: string }) {
    return this.application.createHousehold(this.actor, input);
  }

  readLegacyShareKey(householdId: string) {
    return this.application.readLegacyShareKey(this.actor, householdId);
  }

  deleteHousehold(input: {
    householdId: string;
    confirmed: boolean;
    expectedVersion: number;
    idempotencyKey: string;
  }) {
    return this.application.deleteHousehold(this.actor, input);
  }

  async snapshot(): Promise<AdminConsoleSnapshot> {
    const state = await this.store.read();
    return {
      households: state.households.map(view),
    };
  }

  async publishedEvents(): Promise<readonly AdminConsoleEvent[]> {
    return (await this.store.read()).events.map((event) => ({ ...event }));
  }
}

export function createAdminHouseholdConsoleFixtureSubject(): AdminHouseholdConsoleFixtureSubject {
  const store = new FixtureAdminHouseholdStore();
  const application = createAdminHouseholdConsoleApplication({
    store,
    identities: new FixtureAdminHouseholdIdentity(),
    clock: new FixtureAdminHouseholdClock(),
  });
  return new FixtureAdminHouseholdConsoleController(application, store);
}
