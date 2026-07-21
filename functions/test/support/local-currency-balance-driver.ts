import { createLocalCurrencyBalanceApplication } from "../../src/contexts/household-finance/local-currency/application/localCurrencyBalanceApplication";
import { createBalanceObservationIntakeApplication } from "../../src/contexts/household-finance/local-currency/application/balanceObservationIntakeApplication";
import type {
  BalanceObservationReceipt,
  LocalCurrencyBalanceChangedEvent,
  LocalCurrencyBalanceClock,
  LocalCurrencyBalanceStore,
  LocalCurrencyBalanceTransaction,
} from "../../src/contexts/household-finance/local-currency/application/ports/outbound/localCurrencyBalanceStore";
import type {
  LegacyLocalCurrencyBalanceState,
  LocalCurrencyBalanceState,
} from "../../src/contexts/household-finance/local-currency/domain/model/localCurrencyBalance";
import type {
  BalanceView,
  LocalCurrencyBalanceInputPort,
  LocalCurrencyType,
} from "../../src/contexts/household-finance/local-currency/public";
import type {
  BalanceObservationIntakeInputPort,
  BalanceObservationIntakeResult,
  BalanceObservationV1,
  BalanceRecorderActor,
} from "../../src/contexts/household-finance/local-currency/public";

type SupportedLocalCurrencyType = Exclude<
  LocalCurrencyType,
  "legacy-unknown"
>;

type CurrentBalanceFixture = Omit<BalanceView, "localCurrencyType"> & {
  localCurrencyType: SupportedLocalCurrencyType;
};

export interface LocalCurrencyBalanceFixture {
  current?: readonly CurrentBalanceFixture[];
  legacyWithoutType?: Omit<BalanceView, "localCurrencyType">;
  failRead?: boolean;
}

export interface LocalCurrencyBalanceFixtureSubject
  extends LocalCurrencyBalanceInputPort {
  listForTest(householdId: string): readonly BalanceView[];
  recordedEventCount(): number;
}

function balanceKey(
  householdId: string,
  localCurrencyType: SupportedLocalCurrencyType,
): string {
  return JSON.stringify([householdId, localCurrencyType]);
}

function receiptKey(householdId: string, observationId: string): string {
  return JSON.stringify([householdId, observationId]);
}

function cloneBalance(
  balance: LocalCurrencyBalanceState,
): LocalCurrencyBalanceState {
  return { ...balance };
}

function cloneReceipt(
  receipt: BalanceObservationReceipt,
): BalanceObservationReceipt {
  return {
    ...receipt,
    result: {
      ...receipt.result,
      value: { ...receipt.result.value },
    },
  };
}

class FixtureTransaction implements LocalCurrencyBalanceTransaction {
  constructor(
    private readonly balances: Map<string, LocalCurrencyBalanceState>,
    private readonly receipts: Map<string, BalanceObservationReceipt>,
    private readonly events: LocalCurrencyBalanceChangedEvent[],
    private readonly failRead: boolean,
  ) {}

  async readBalance(
    householdId: string,
    localCurrencyType: SupportedLocalCurrencyType,
  ): Promise<LocalCurrencyBalanceState | null> {
    if (this.failRead) {
      throw new Error("fixture balance repository unavailable");
    }
    const balance = this.balances.get(balanceKey(householdId, localCurrencyType));
    return balance === undefined ? null : cloneBalance(balance);
  }

  async readReceipt(
    householdId: string,
    observationId: string,
  ): Promise<BalanceObservationReceipt | null> {
    if (this.failRead) {
      throw new Error("fixture receipt repository unavailable");
    }
    const receipt = this.receipts.get(receiptKey(householdId, observationId));
    return receipt === undefined ? null : cloneReceipt(receipt);
  }

  async saveBalance(balance: LocalCurrencyBalanceState): Promise<void> {
    this.balances.set(
      balanceKey(balance.householdId, balance.localCurrencyType),
      cloneBalance(balance),
    );
  }

  async saveReceipt(receipt: BalanceObservationReceipt): Promise<void> {
    this.receipts.set(
      receiptKey(receipt.householdId, receipt.observationId),
      cloneReceipt(receipt),
    );
  }

  async appendChangedEvent(
    event: LocalCurrencyBalanceChangedEvent,
  ): Promise<void> {
    this.events.push({ ...event });
  }
}

class FixtureBalanceStore implements LocalCurrencyBalanceStore {
  private balances: Map<string, LocalCurrencyBalanceState>;
  private receipts = new Map<string, BalanceObservationReceipt>();
  private events: LocalCurrencyBalanceChangedEvent[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(
    current: readonly CurrentBalanceFixture[],
    private readonly legacy: Omit<BalanceView, "localCurrencyType"> | undefined,
    private readonly failRead: boolean,
  ) {
    this.balances = new Map(
      current.map((balance) => [
        balanceKey(balance.householdId, balance.localCurrencyType),
        {
          ...balance,
          lastObservationId: "",
        },
      ]),
    );
  }

  async runInHouseholdTransaction<T>(
    _householdId: string,
    operation: (transaction: LocalCurrencyBalanceTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.transactionTail = previous.then(() => gate);

    await previous;
    try {
      const workingBalances = new Map(
        [...this.balances].map(([key, balance]) => [key, cloneBalance(balance)]),
      );
      const workingReceipts = new Map(
        [...this.receipts].map(([key, receipt]) => [key, cloneReceipt(receipt)]),
      );
      const workingEvents = this.events.map((event) => ({ ...event }));
      const transaction = new FixtureTransaction(
        workingBalances,
        workingReceipts,
        workingEvents,
        this.failRead,
      );

      const result = await operation(transaction);
      this.balances = workingBalances;
      this.receipts = workingReceipts;
      this.events = workingEvents;
      return result;
    } finally {
      release();
    }
  }

  async readBalance(
    householdId: string,
    localCurrencyType: SupportedLocalCurrencyType,
  ): Promise<LocalCurrencyBalanceState | null> {
    if (this.failRead) {
      throw new Error("fixture balance repository unavailable");
    }
    const balance = this.balances.get(balanceKey(householdId, localCurrencyType));
    return balance === undefined ? null : cloneBalance(balance);
  }

  async readLegacyBalance(
    householdId: string,
  ): Promise<LegacyLocalCurrencyBalanceState | null> {
    if (this.failRead) {
      throw new Error("fixture legacy repository unavailable");
    }
    if (this.legacy === undefined || this.legacy.householdId !== householdId) {
      return null;
    }
    return { ...this.legacy };
  }

  list(householdId: string): readonly BalanceView[] {
    return [...this.balances.values()]
      .filter((balance) => balance.householdId === householdId)
      .sort((left, right) =>
        left.localCurrencyType.localeCompare(right.localCurrencyType),
      )
      .map(({ lastObservationId: _lastObservationId, ...view }) => ({ ...view }));
  }

  eventCount(): number {
    return this.events.length;
  }

  receiptViews(): readonly {
    observationId: string;
    resultKind: "created" | "updated" | "staleIgnored";
  }[] {
    return [...this.receipts.values()].map((receipt) => ({
      observationId: receipt.observationId,
      resultKind: receipt.result.status,
    }));
  }

  eventViews(): readonly LocalCurrencyBalanceChangedEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
}

class FixtureClock implements LocalCurrencyBalanceClock {
  private tick = 0;

  now(): string {
    const timestamp = Date.parse("2026-07-20T00:00:00.000Z") + this.tick;
    this.tick += 1;
    return new Date(timestamp).toISOString();
  }
}

export function createLocalCurrencyBalanceFixtureSubject(
  fixture: LocalCurrencyBalanceFixture = {},
): LocalCurrencyBalanceFixtureSubject {
  const store = new FixtureBalanceStore(
    fixture.current ?? [],
    fixture.legacyWithoutType,
    fixture.failRead ?? false,
  );
  const application = createLocalCurrencyBalanceApplication(
    store,
    new FixtureClock(),
  );

  return {
    record: (input) => application.record(input),
    get: (householdId, localCurrencyType) =>
      application.get(householdId, localCurrencyType),
    listForTest: (householdId) => store.list(householdId),
    recordedEventCount: () => store.eventCount(),
  };
}

export interface BalanceObservationIntakeFixtureSubject
  extends BalanceObservationIntakeInputPort {
  snapshot(): Promise<{
    balances: readonly {
      balanceId: string;
      householdId: string;
      localCurrencyType: SupportedLocalCurrencyType;
      balanceInWon: number;
      observedAt: string;
      balanceVersion: number;
    }[];
    receipts: readonly {
      observationId: string;
      resultKind: "created" | "updated" | "staleIgnored";
    }[];
  }>;
  publishedEvents(): Promise<
    readonly {
      eventType: "LocalCurrencyBalanceChanged.v1";
      householdId: string;
      localCurrencyType: SupportedLocalCurrencyType;
      balanceId: string;
      balanceVersion: number;
    }[]
  >;
}

export function createBalanceObservationIntakeFixtureSubject(): BalanceObservationIntakeFixtureSubject {
  const store = new FixtureBalanceStore([], undefined, false);
  const balances = createLocalCurrencyBalanceApplication(
    store,
    new FixtureClock(),
  );
  const intake = createBalanceObservationIntakeApplication({ balances });
  return {
    recordBalanceObservation: (
      actor: BalanceRecorderActor,
      observation: BalanceObservationV1,
    ): Promise<BalanceObservationIntakeResult> =>
      intake.recordBalanceObservation(actor, observation),
    snapshot: async () => ({
      balances: store.list("house-1").map((balance) => ({
        balanceId: balance.balanceId,
        householdId: balance.householdId,
        localCurrencyType:
          balance.localCurrencyType as SupportedLocalCurrencyType,
        balanceInWon: balance.balanceInWon,
        observedAt: balance.observedAt,
        balanceVersion: balance.balanceVersion,
      })),
      receipts: store.receiptViews(),
    }),
    publishedEvents: async () =>
      store.eventViews().map((event) => ({
        eventType: "LocalCurrencyBalanceChanged.v1" as const,
        householdId: event.householdId,
        localCurrencyType: event.localCurrencyType,
        balanceId: event.balanceId,
        balanceVersion: event.balanceVersion,
      })),
  };
}
