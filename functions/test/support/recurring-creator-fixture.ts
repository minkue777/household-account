import { createRecurringCreatorApplication } from "../../src/contexts/household-finance/recurring/application/recurringCreatorApplication";
import { createRecurringPlanManagementApplication } from "../../src/contexts/household-finance/recurring/application/recurringPlanManagementApplication";
import type {
  RecurringCreatorClockPort,
  RecurringCreatorLedgerPort,
  RecurringCreatorMutation,
  RecurringCreatorStorePort,
  RecurringMemberIdentityPort,
} from "../../src/contexts/household-finance/recurring/application/ports/out/recurringCreatorPorts";
import type {
  RecurringCategoryReferencePort,
  RecurringPlanClockPort,
  RecurringPlanIdentityPort,
  RecurringPlanListRead,
  RecurringPlanManagementStorePort,
  RecurringPlanMutation,
} from "../../src/contexts/household-finance/recurring/application/ports/out/recurringPlanManagementPorts";
import type {
  RecurringCreatorMigrationReceipt,
  RecurringCreatorMigrationState,
  RecurringPlan,
  RecurringPlanChangedEvent,
  RecurringPlanCommandReceipt,
  RecurringPlanManagementState,
} from "../../src/contexts/household-finance/recurring/domain/model/recurringPlan";
import type {
  ManageRecurringPlanResult,
  MapLegacyRecurringCreatorResult,
  ProcessRecurringCreatorResult,
  RecurringCreatedTransactionView,
  RecurringCreatorInputPort,
  RecurringPlanManagementInputPort,
} from "../../src/contexts/household-finance/recurring/public";

export interface MemberIdentitySeed {
  householdId: string;
  memberId: string;
}

export interface LegacyRecurringPlanSeed {
  householdId: string;
  planId: string;
  creatorMemberId?: string;
  version: number;
}

export type RecurringTransactionSeed = RecurringCreatedTransactionView;

export interface RecurringCreatorFixture {
  members?: readonly MemberIdentitySeed[];
  legacyPlans?: readonly LegacyRecurringPlanSeed[];
  transactions?: readonly RecurringTransactionSeed[];
}

export interface RecurringCreatorFixtureSubject {
  createPlan(input: {
    householdId: string;
    actingMemberId: string;
    merchant: string;
  }): Promise<ManageRecurringPlanResult>;
  updatePlan(input: {
    householdId: string;
    actingMemberId: string;
    planId: string;
    merchant: string;
    expectedVersion: number;
  }): Promise<ManageRecurringPlanResult>;
  processMonth(input: {
    householdId: string;
    planId: string;
    targetMonth: string;
    systemActorId: string;
    currentActiveMemberIds: readonly string[];
  }): Promise<ProcessRecurringCreatorResult>;
  mapLegacyCreator(input: {
    householdId: string;
    migrationActorId: string;
    planId: string;
    creatorMemberId: string;
    expectedVersion: number;
  }): Promise<MapLegacyRecurringCreatorResult>;
  transactions(): Promise<readonly RecurringTransactionSeed[]>;
  migrationAudit(): Promise<{
    receipts: readonly {
      householdId: string;
      planId: string;
      creatorMemberId: string;
      migrationActorId: string;
      migratedAt: string;
      previousPlanVersion: number;
    }[];
    events: readonly {
      eventType: "RecurringPlanChanged.v1";
      planId: string;
      changeKind: "updated";
      planVersion: number;
    }[];
  }>;
}

interface CombinedRecurringState {
  plans: readonly RecurringPlan[];
  managementReceipts: readonly RecurringPlanCommandReceipt[];
  migrationReceipts: readonly RecurringCreatorMigrationReceipt[];
  events: readonly RecurringPlanChangedEvent[];
}

function clonePlan(plan: RecurringPlan): RecurringPlan {
  return { ...plan };
}

function cloneEvent(event: RecurringPlanChangedEvent): RecurringPlanChangedEvent {
  return { ...event };
}

function cloneCombined(state: CombinedRecurringState): CombinedRecurringState {
  return {
    plans: state.plans.map(clonePlan),
    managementReceipts: state.managementReceipts.map((receipt) => ({
      ...receipt,
      plan: { ...receipt.plan },
    })),
    migrationReceipts: state.migrationReceipts.map((receipt) => ({
      ...receipt,
    })),
    events: state.events.map(cloneEvent),
  };
}

class SharedRecurringState {
  private state: CombinedRecurringState;
  private serial: Promise<void> = Promise.resolve();

  constructor(plans: readonly RecurringPlan[]) {
    this.state = {
      plans: plans.map(clonePlan),
      managementReceipts: [],
      migrationReceipts: [],
      events: [],
    };
  }

  async read(): Promise<CombinedRecurringState> {
    await this.serial;
    return cloneCombined(this.state);
  }

  async transact<T>(
    operation: (current: CombinedRecurringState) => {
      state: CombinedRecurringState;
      value: T;
    },
  ): Promise<T> {
    const transaction = this.serial.then(() => {
      const mutation = operation(cloneCombined(this.state));
      this.state = cloneCombined(mutation.state);
      return mutation.value;
    });
    this.serial = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }
}

class CreatorFixtureManagementStore
  implements RecurringPlanManagementStorePort
{
  constructor(private readonly shared: SharedRecurringState) {}

  async read(): Promise<RecurringPlanManagementState> {
    const state = await this.shared.read();
    return {
      plans: state.plans,
      receipts: state.managementReceipts,
      events: state.events,
    };
  }

  async readReceipt(commandId: string) {
    return (await this.read()).receipts.find(
      (receipt) => receipt.commandId === commandId,
    );
  }

  async readForList(): Promise<RecurringPlanListRead> {
    return { kind: "success", state: await this.read() };
  }

  transact<T>(
    operation: (
      current: RecurringPlanManagementState,
    ) => RecurringPlanMutation<T>,
  ): Promise<T> {
    return this.shared.transact((current) => {
      const mutation = operation({
        plans: current.plans,
        receipts: current.managementReceipts,
        events: current.events,
      });
      return {
        state: {
          ...current,
          plans: mutation.state.plans,
          managementReceipts: mutation.state.receipts,
          events: mutation.state.events,
        },
        value: mutation.value,
      };
    });
  }
}

class CreatorFixtureMigrationStore implements RecurringCreatorStorePort {
  constructor(private readonly shared: SharedRecurringState) {}

  async read(): Promise<RecurringCreatorMigrationState> {
    const state = await this.shared.read();
    return {
      plans: state.plans,
      receipts: state.migrationReceipts,
      events: state.events,
    };
  }

  transact<T>(
    operation: (
      current: RecurringCreatorMigrationState,
    ) => RecurringCreatorMutation<T>,
  ): Promise<T> {
    return this.shared.transact((current) => {
      const mutation = operation({
        plans: current.plans,
        receipts: current.migrationReceipts,
        events: current.events,
      });
      return {
        state: {
          ...current,
          plans: mutation.state.plans,
          migrationReceipts: mutation.state.receipts,
          events: mutation.state.events,
        },
        value: mutation.value,
      };
    });
  }
}

class CreatorFixtureClock
  implements RecurringPlanClockPort, RecurringCreatorClockPort
{
  now(): string {
    return "2026-07-01T00:00:00.000Z";
  }

  localDate(): string {
    return "2026-07-01";
  }
}

class CreatorFixturePlanIds implements RecurringPlanIdentityPort {
  planId(commandId: string): string {
    return `plan-${commandId}`;
  }
}

class CreatorFixtureCategories implements RecurringCategoryReferencePort {
  async resolveUsableCategory() {
    return { kind: "usable" as const };
  }
}

class CreatorFixtureMembers implements RecurringMemberIdentityPort {
  constructor(private readonly members: readonly MemberIdentitySeed[]) {}

  async belongsToHousehold(
    householdId: string,
    memberId: string,
  ): Promise<boolean> {
    return this.members.some(
      (member) =>
        member.householdId === householdId && member.memberId === memberId,
    );
  }
}

class CreatorFixtureLedger implements RecurringCreatorLedgerPort {
  private readonly items: RecurringTransactionSeed[];
  private readonly processed = new Map<string, RecurringTransactionSeed>();

  constructor(transactions: readonly RecurringTransactionSeed[]) {
    this.items = transactions.map((transaction) => ({ ...transaction }));
  }

  async recordRecurringTransaction(input: {
    householdId: string;
    plan: RecurringPlan & { creatorMemberId: string };
    targetMonth: string;
    idempotencyKey: string;
  }) {
    const prior = this.processed.get(input.idempotencyKey);
    if (prior !== undefined) {
      return { kind: "already-processed" as const, transaction: { ...prior } };
    }
    const transaction: RecurringTransactionSeed = {
      transactionId: `recurring-${input.plan.planId}-${input.targetMonth}`,
      planId: input.plan.planId,
      creatorMemberId: input.plan.creatorMemberId,
      source: "recurring",
    };
    this.items.push(transaction);
    this.processed.set(input.idempotencyKey, transaction);
    return { kind: "created" as const, transaction: { ...transaction } };
  }

  transactions(): readonly RecurringTransactionSeed[] {
    return this.items.map((transaction) => ({ ...transaction }));
  }
}

function legacyPlan(seed: LegacyRecurringPlanSeed): RecurringPlan {
  return {
    householdId: seed.householdId,
    planId: seed.planId,
    merchant: `legacy-${seed.planId}`,
    amountInWon: 10_000,
    categoryId: "fixed",
    dayOfMonth: 18,
    memo: "",
    active: true,
    ...(seed.creatorMemberId === undefined
      ? {}
      : { creatorMemberId: seed.creatorMemberId }),
    firstApplicableMonth: "2026-07",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lifecycleState: "active",
    version: seed.version,
  };
}

class RecurringCreatorFixtureDriver
  implements RecurringCreatorFixtureSubject
{
  private createSequence = 1;

  constructor(
    private readonly plans: RecurringPlanManagementInputPort,
    private readonly creators: RecurringCreatorInputPort,
    private readonly ledger: CreatorFixtureLedger,
    private readonly shared: SharedRecurringState,
  ) {}

  createPlan(input: {
    householdId: string;
    actingMemberId: string;
    merchant: string;
  }) {
    const sequence = this.createSequence;
    this.createSequence += 1;
    return this.plans.manage({
      commandId: `creator-contract-create-${sequence}`,
      actor: {
        householdId: input.householdId,
        actingMemberId: input.actingMemberId,
        capabilities: ["recurring.manage", "recurring.read"],
      },
      operation: {
        kind: "create",
        merchant: input.merchant,
        amountInWon: 10_000,
        categoryId: "fixed",
        dayOfMonth: 18,
        active: true,
      },
    });
  }

  updatePlan(input: {
    householdId: string;
    actingMemberId: string;
    planId: string;
    merchant: string;
    expectedVersion: number;
  }) {
    return this.plans.manage({
      commandId: `creator-contract-update-${input.planId}-${input.expectedVersion}`,
      actor: {
        householdId: input.householdId,
        actingMemberId: input.actingMemberId,
        capabilities: ["recurring.manage", "recurring.read"],
      },
      operation: {
        kind: "update",
        planId: input.planId,
        expectedVersion: input.expectedVersion,
        patch: { merchant: input.merchant },
      },
    });
  }

  processMonth(input: {
    householdId: string;
    planId: string;
    targetMonth: string;
    systemActorId: string;
    currentActiveMemberIds: readonly string[];
  }) {
    void input.currentActiveMemberIds;
    return this.creators.processRecurringMonthWithCreator(
      {
        actorId: input.systemActorId,
        capabilities: ["recurring.process"],
      },
      {
        householdId: input.householdId,
        planId: input.planId,
        targetMonth: input.targetMonth,
      },
    );
  }

  mapLegacyCreator(input: {
    householdId: string;
    migrationActorId: string;
    planId: string;
    creatorMemberId: string;
    expectedVersion: number;
  }) {
    return this.creators.mapLegacyCreator(
      {
        actorId: input.migrationActorId,
        capabilities: ["recurring.migrate"],
      },
      {
        commandId: [
          "map-legacy-creator",
          input.householdId,
          input.planId,
          input.creatorMemberId,
          input.expectedVersion,
        ].join(":"),
        householdId: input.householdId,
        planId: input.planId,
        creatorMemberId: input.creatorMemberId,
        expectedVersion: input.expectedVersion,
      },
    );
  }

  async transactions(): Promise<readonly RecurringTransactionSeed[]> {
    return this.ledger.transactions();
  }

  async migrationAudit() {
    const state = await this.shared.read();
    return {
      receipts: state.migrationReceipts.map(
        ({
          householdId,
          planId,
          creatorMemberId,
          migrationActorId,
          migratedAt,
          previousPlanVersion,
        }) => ({
          householdId,
          planId,
          creatorMemberId,
          migrationActorId,
          migratedAt,
          previousPlanVersion,
        }),
      ),
      events: state.events
        .filter((event) => event.changeKind === "updated")
        .map(({ eventType, planId, changeKind, planVersion }) => ({
          eventType,
          planId,
          changeKind: changeKind as "updated",
          planVersion,
        })),
    };
  }
}

export function createRecurringCreatorFixtureSubject(
  fixture: RecurringCreatorFixture = {},
): RecurringCreatorFixtureSubject {
  const shared = new SharedRecurringState(
    (fixture.legacyPlans ?? []).map(legacyPlan),
  );
  const clock = new CreatorFixtureClock();
  const ledger = new CreatorFixtureLedger(fixture.transactions ?? []);
  const plans = createRecurringPlanManagementApplication({
    store: new CreatorFixtureManagementStore(shared),
    clock,
    identities: new CreatorFixturePlanIds(),
    categories: new CreatorFixtureCategories(),
  });
  const creators = createRecurringCreatorApplication({
    store: new CreatorFixtureMigrationStore(shared),
    members: new CreatorFixtureMembers(fixture.members ?? []),
    ledger,
    clock,
  });
  return new RecurringCreatorFixtureDriver(plans, creators, ledger, shared);
}
