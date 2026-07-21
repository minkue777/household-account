import { createHouseholdLifecycleApplication } from "../../src/contexts/access/household-lifecycle/application/householdLifecycleApplication";
import type {
  HouseholdLifecycleClockPort,
  HouseholdLifecycleHashPort,
  HouseholdLifecycleIdentityPort,
  HouseholdLifecycleMutation,
  HouseholdLifecycleUnitOfWorkPort,
} from "../../src/contexts/access/household-lifecycle/application/ports/out/householdLifecyclePorts";
import type { HouseholdLifecycleState } from "../../src/contexts/access/household-lifecycle/domain/model/householdLifecycle";
import type {
  HouseholdLifecycleEvent,
  HouseholdLifecycleInputPort,
  HouseholdLifecycleView,
} from "../../src/contexts/access/public";

export interface HouseholdLifecycleFixture {
  now: string;
  household: HouseholdLifecycleView;
  membershipClaims: readonly {
    principalUid: string;
    householdId: string;
    membershipId: string;
    version: number;
  }[];
  preservedData: Readonly<Record<string, string>>;
}

export interface HouseholdLifecycleSnapshot {
  household: HouseholdLifecycleView;
  membershipClaims: HouseholdLifecycleFixture["membershipClaims"];
  preservedData: HouseholdLifecycleFixture["preservedData"];
  purgeProcess?: {
    processId: string;
    status: "requested" | "running" | "completed";
  };
}

export interface HouseholdLifecycleFixtureSubject
  extends HouseholdLifecycleInputPort {
  setCurrentTime(instant: string): void;
  snapshot(): Promise<HouseholdLifecycleSnapshot>;
  publishedEvents(): Promise<readonly HouseholdLifecycleEvent[]>;
}

function cloneState(state: HouseholdLifecycleState): HouseholdLifecycleState {
  return {
    household: { ...state.household },
    ...(state.purgeProcess === undefined
      ? {}
      : { purgeProcess: { ...state.purgeProcess } }),
    receipts: state.receipts.map((receipt) => ({
      ...receipt,
      result: {
        ...receipt.result,
        household: { ...receipt.result.household },
      },
    })),
    events: state.events.map((event) => ({ ...event })),
  };
}

class FixtureHouseholdLifecycleUnitOfWork
  implements HouseholdLifecycleUnitOfWorkPort
{
  private stateValue: HouseholdLifecycleState;
  private serial: Promise<void> = Promise.resolve();

  constructor(fixture: HouseholdLifecycleFixture) {
    this.stateValue = {
      household: { ...fixture.household },
      receipts: [],
      events: [],
    };
  }

  async read(): Promise<HouseholdLifecycleState> {
    await this.serial;
    return cloneState(this.stateValue);
  }

  async transact<T>(
    operation: (
      state: HouseholdLifecycleState,
    ) => HouseholdLifecycleMutation<T>,
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

class FixtureHouseholdLifecycleClock implements HouseholdLifecycleClockPort {
  constructor(private current: string) {}

  now(): string {
    return this.current;
  }

  setCurrentTime(instant: string): void {
    this.current = instant;
  }
}

class FixtureHouseholdLifecycleIdentity
  implements HouseholdLifecycleIdentityPort
{
  nextPurgeProcessId(idempotencyKey: string): string {
    return `purge-process:${idempotencyKey}`;
  }
}

class FixtureHouseholdLifecycleHash implements HouseholdLifecycleHashPort {
  hashSensitiveReference(value: string): string {
    return `hash:${value.length}`;
  }
}

class HouseholdLifecycleFixtureDriver
  implements HouseholdLifecycleFixtureSubject
{
  private readonly claims: HouseholdLifecycleFixture["membershipClaims"];
  private readonly preservedData: HouseholdLifecycleFixture["preservedData"];

  constructor(
    private readonly application: HouseholdLifecycleInputPort,
    private readonly unitOfWork: FixtureHouseholdLifecycleUnitOfWork,
    private readonly clock: FixtureHouseholdLifecycleClock,
    fixture: HouseholdLifecycleFixture,
  ) {
    this.claims = fixture.membershipClaims.map((claim) => ({ ...claim }));
    this.preservedData = { ...fixture.preservedData };
  }

  requestHouseholdDeletion(...args: Parameters<HouseholdLifecycleInputPort["requestHouseholdDeletion"]>) {
    return this.application.requestHouseholdDeletion(...args);
  }

  restoreDeletedHousehold(...args: Parameters<HouseholdLifecycleInputPort["restoreDeletedHousehold"]>) {
    return this.application.restoreDeletedHousehold(...args);
  }

  requestPermanentHouseholdPurge(...args: Parameters<HouseholdLifecycleInputPort["requestPermanentHouseholdPurge"]>) {
    return this.application.requestPermanentHouseholdPurge(...args);
  }

  authorizeBusinessAccess(...args: Parameters<HouseholdLifecycleInputPort["authorizeBusinessAccess"]>) {
    return this.application.authorizeBusinessAccess(...args);
  }

  setCurrentTime(instant: string): void {
    this.clock.setCurrentTime(instant);
  }

  async snapshot(): Promise<HouseholdLifecycleSnapshot> {
    const state = await this.unitOfWork.read();
    return {
      household: {
        householdId: state.household.householdId,
        lifecycleState: state.household.lifecycleState,
        aggregateVersion: state.household.aggregateVersion,
        ...(state.household.deletedAt === undefined
          ? {}
          : { deletedAt: state.household.deletedAt }),
      },
      membershipClaims: this.claims.map((claim) => ({ ...claim })),
      preservedData: { ...this.preservedData },
      ...(state.purgeProcess === undefined
        ? {}
        : {
            purgeProcess: {
              processId: state.purgeProcess.processId,
              status: state.purgeProcess.status,
            },
          }),
    };
  }

  async publishedEvents(): Promise<readonly HouseholdLifecycleEvent[]> {
    return (await this.unitOfWork.read()).events.map((event) => ({ ...event }));
  }
}

export function createHouseholdLifecycleFixtureSubject(
  fixture: HouseholdLifecycleFixture,
): HouseholdLifecycleFixtureSubject {
  const unitOfWork = new FixtureHouseholdLifecycleUnitOfWork(fixture);
  const clock = new FixtureHouseholdLifecycleClock(fixture.now);
  return new HouseholdLifecycleFixtureDriver(
    createHouseholdLifecycleApplication({
      unitOfWork,
      clock,
      identities: new FixtureHouseholdLifecycleIdentity(),
      hash: new FixtureHouseholdLifecycleHash(),
    }),
    unitOfWork,
    clock,
    fixture,
  );
}
