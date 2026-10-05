import { createRecurringPlanManagementApplication } from "../../src/contexts/household-finance/recurring/application/recurringPlanManagementApplication";
import type {
  RecurringPlanClockPort,
  RecurringPlanIdentityPort,
  RecurringPlanListRead,
  RecurringPlanManagementStorePort,
} from "../../src/contexts/household-finance/recurring/application/ports/out/recurringPlanManagementPorts";
import type {
  CreatorMappedRecurringPlan,
  RecurringPlan,
  RecurringPlanCommandReceipt,
  RecurringPlanChangedEvent,
} from "../../src/contexts/household-finance/recurring/domain/model/recurringPlan";
import { hasRecurringPlanCreator } from "../../src/contexts/household-finance/recurring/domain/model/recurringPlan";
import type {
  RecurringPlanManagementInputPort,
  RecurringPlanView,
} from "../../src/contexts/household-finance/recurring/public";

interface RecurringPlanManagementState {
  plans: readonly RecurringPlan[];
  receipts: readonly RecurringPlanCommandReceipt[];
  events: readonly RecurringPlanChangedEvent[];
}

export interface RecurringPlanManagementFixture {
  now: string;
  usableCategoryIds?: readonly string[];
  plans?: readonly RecurringPlanView[];
  failList?: boolean;
}

export interface RecurringPlanManagementSnapshot {
  plans: readonly RecurringPlanView[];
  receipts: readonly {
    commandId: string;
    resultKind: "created" | "updated" | "deleted";
    planId: string;
  }[];
  events: readonly {
    eventType: "RecurringPlanChanged.v1";
    planId: string;
    changeKind: "created" | "updated" | "deleted";
    planVersion: number;
  }[];
}

export interface RecurringPlanManagementFixtureSubject
  extends RecurringPlanManagementInputPort {
  snapshot(): Promise<RecurringPlanManagementSnapshot>;
}

function clonePlan(plan: RecurringPlan): RecurringPlan {
  return { ...plan };
}

function cloneMappedPlan(
  plan: CreatorMappedRecurringPlan,
): CreatorMappedRecurringPlan {
  return { ...plan };
}

function cloneReceipt(
  receipt: RecurringPlanCommandReceipt,
): RecurringPlanCommandReceipt {
  return { ...receipt, plan: cloneMappedPlan(receipt.plan) };
}

function cloneState(
  state: RecurringPlanManagementState,
): RecurringPlanManagementState {
  return {
    plans: state.plans.map(clonePlan),
    receipts: state.receipts.map(cloneReceipt),
    events: state.events.map((event) => ({ ...event })),
  };
}

class FixtureRecurringPlanStore implements RecurringPlanManagementStorePort {
  private stateValue: RecurringPlanManagementState;
  private serial: Promise<void> = Promise.resolve();

  constructor(
    plans: readonly RecurringPlanView[],
    private readonly failList: boolean,
    private readonly usableCategoryIds?: readonly string[],
  ) {
    this.stateValue = {
      plans: plans.map(clonePlan),
      receipts: [],
      events: [],
    };
  }

  async read(): Promise<RecurringPlanManagementState> {
    await this.serial;
    return cloneState(this.stateValue);
  }

  async readForList(): Promise<RecurringPlanListRead> {
    if (this.failList) {
      return {
        kind: "retryable-failure",
        code: "RECURRING_PLAN_REPOSITORY_UNAVAILABLE",
      };
    }
    return { kind: "success", plans: (await this.read()).plans };
  }

  async transact<T>(planId: string, commandId: string,
    operation: Parameters<RecurringPlanManagementStorePort["transact"]>[2]): Promise<T> {
    const transaction = this.serial.then(async () => {
      const mutation = await operation({
        plan: this.stateValue.plans.find(plan => plan.planId === planId),
        receipt: this.stateValue.receipts.find(receipt => receipt.commandId === commandId),
        categoryIsUsable: async id => !!id && (this.usableCategoryIds === undefined || this.usableCategoryIds.includes(id)),
      });
      if (mutation.change) {
        const { plan, receipt, event } = mutation.change;
        this.stateValue = cloneState({ plans: [...this.stateValue.plans.filter(value => value.planId !== planId), plan],
          receipts: [...this.stateValue.receipts, receipt], events: [...this.stateValue.events, event] });
      }
      return mutation.value as T;
    });
    this.serial = transaction.then(() => undefined, () => undefined);
    return transaction;
  }
}

class FixtureRecurringClock implements RecurringPlanClockPort {
  constructor(private readonly instant: string) {}

  now(): string {
    return this.instant;
  }

  localDate(): string {
    const instant = new Date(this.instant);
    return new Date(instant.getTime() + 9 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);
  }
}

class FixtureRecurringPlanIdentities implements RecurringPlanIdentityPort {
  planId(commandId: string): string {
    return `plan-${commandId}`;
  }
}

class FixtureRecurringPlanDriver
  implements RecurringPlanManagementFixtureSubject
{
  constructor(
    private readonly application: RecurringPlanManagementInputPort,
    private readonly store: FixtureRecurringPlanStore,
  ) {}

  manage(
    ...args: Parameters<RecurringPlanManagementInputPort["manage"]>
  ) {
    return this.application.manage(...args);
  }

  list(...args: Parameters<RecurringPlanManagementInputPort["list"]>) {
    return this.application.list(...args);
  }

  async snapshot(): Promise<RecurringPlanManagementSnapshot> {
    const state = await this.store.read();
    return {
      plans: state.plans
        .filter(hasRecurringPlanCreator)
        .map(cloneMappedPlan),
      receipts: state.receipts.map(
        ({ commandId, resultKind, planId }) => ({
          commandId,
          resultKind,
          planId,
        }),
      ),
      events: state.events.map(
        ({ eventType, planId, changeKind, planVersion }) => ({
          eventType,
          planId,
          changeKind,
          planVersion,
        }),
      ),
    };
  }
}

export function createRecurringPlanManagementFixtureSubject(
  fixture: RecurringPlanManagementFixture,
): RecurringPlanManagementFixtureSubject {
  const store = new FixtureRecurringPlanStore(
    fixture.plans ?? [],
    fixture.failList ?? false,
    fixture.usableCategoryIds,
  );
  const application = createRecurringPlanManagementApplication({
    store,
    clock: new FixtureRecurringClock(fixture.now),
    identities: new FixtureRecurringPlanIdentities(),
  });
  return new FixtureRecurringPlanDriver(application, store);
}
