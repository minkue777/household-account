import { createRecurringSchedulerWorkflowApplication } from "../../src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication";
import type {
  RecurringFinanceUnitOfWork,
} from "../../src/contexts/household-finance/recurring/application/ports/out/recurringProcessingPorts";
import type {
  ProcessRecurringTargetResult,
  RecurringExecution,
  RecurringProcessingDecision,
  RecurringProcessingState,
  RecurringProcessPlan,
} from "../../src/contexts/household-finance/recurring/domain/model/recurringProcessing";
import type { RecurringSchedulerWorkflowInputPort } from "../../src/contexts/household-finance/recurring/public";

export type RecurringCommitFailure = "transaction-save" | "execution-checkpoint-save" | "receipt-save";

function cloneState(state: RecurringProcessingState): RecurringProcessingState {
  return structuredClone(state);
}

function failureCode(failure: RecurringCommitFailure): string {
  switch (failure) {
    case "transaction-save":
      return "LEDGER_TRANSACTION_SAVE_FAILED";
    case "execution-checkpoint-save":
      return "RECURRING_CHECKPOINT_SAVE_FAILED";
    case "receipt-save":
      return "PROCESS_RECEIPT_SAVE_FAILED";
  }
}

class FixtureRecurringFinanceUnitOfWork implements RecurringFinanceUnitOfWork {
  private stateValue: RecurringProcessingState;
  private queue: Promise<void> = Promise.resolve();
  private globalFailure?: RecurringCommitFailure;
  private readonly targetFailures = new Map<string, RecurringCommitFailure>();

  constructor(input: {
    plans: readonly RecurringProcessPlan[];
    completedExecutions?: readonly RecurringExecution[];
    failTargetKeys?: readonly string[];
  }) {
    this.stateValue = {
      plans: input.plans.map((plan) => ({ ...plan })),
      executions: (input.completedExecutions ?? []).map((execution) => ({
        ...execution,
      })),
      ledgerTransactions: [],
      receipts: [],
      outboxEvents: [],
    };
    for (const key of input.failTargetKeys ?? []) {
      this.targetFailures.set(key, "transaction-save");
    }
  }

  transact(executionKey: string, decide: (state: RecurringProcessingState) => RecurringProcessingDecision): Promise<ProcessRecurringTargetResult> {
    const pending = this.queue.then(() => {
      const decision = decide(cloneState(this.stateValue));
      if (decision.kind === "return") return decision.result;
      const failure = this.targetFailures.get(executionKey) ?? this.globalFailure;
      if (failure !== undefined) return { kind: "retryable-failure" as const, planId: decision.result.planId,
        targetMonth: executionKey.slice(-7), code: failureCode(failure) };
      this.stateValue = cloneState(decision.nextState);
      return structuredClone(decision.result);
    });
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async readPlanPage(input: { afterPlanId?: string; limit: number }) {
    const plans = (await this.read()).plans.filter(plan => input.afterPlanId === undefined || plan.planId > input.afterPlanId)
      .sort((a, b) => a.planId.localeCompare(b.planId));
    const page = plans.slice(0, input.limit);
    return { plans: page, ...(page.length === input.limit ? { nextCursor: page.at(-1)!.planId } : {}) };
  }

  async read(): Promise<RecurringProcessingState> {
    await this.queue;
    return cloneState(this.stateValue);
  }

  setGlobalFailure(failure?: RecurringCommitFailure): void {
    this.globalFailure = failure;
  }

  clearTargetFailure(key: string): void {
    this.targetFailures.delete(key);
  }
}

export interface RecurringProcessingFixture {
  readonly application: RecurringSchedulerWorkflowInputPort;
  readonly store: FixtureRecurringFinanceUnitOfWork;
}

export function createRecurringProcessingFixture(input: {
  now: string;
  plans: readonly RecurringProcessPlan[];
  completedExecutions?: readonly RecurringExecution[];
  failTargetKeys?: readonly string[];
}): RecurringProcessingFixture {
  const store = new FixtureRecurringFinanceUnitOfWork(input);
  const application = createRecurringSchedulerWorkflowApplication({
    unitOfWork: store,
    clock: {
      now: () => input.now,
      localDate: () => input.now.slice(0, 10),
    },
    ids: {
      transactionId: (executionKey) => `recurring-tx:${executionKey}`,
      eventId: (executionKey, eventType) => `${eventType}:${executionKey}`,
    },

  });
  return {
    application,
    store,
  };
}

export function createRecurringSchedulerWorkflowFixture(input: {
  now: string;
  plans: readonly RecurringProcessPlan[];
  completedExecutions?: readonly RecurringExecution[];
  failTargetKeys?: readonly string[];
}) {
  const fixture = createRecurringProcessingFixture(input);
  return {
    processMonth: (command: Parameters<RecurringSchedulerWorkflowInputPort["processMonth"]>[0]) =>
      fixture.application.processMonth(command),
    processDue: (command: Parameters<RecurringSchedulerWorkflowInputPort["processDue"]>[0]) =>
      fixture.application.processDue(command),
    clearTargetFailureForTest: (targetKey: string) =>
      fixture.store.clearTargetFailure(targetKey),
    async snapshot() {
      const state = await fixture.store.read();
      return {
        executions: state.executions.map((execution) => ({ ...execution })),
        ledgerTransactions: state.ledgerTransactions.map((transaction) => ({
          transactionId: transaction.transactionId,
          planId: transaction.recurringPlanId,
          targetMonth: transaction.recurringTargetMonth,
          transactionType: transaction.transactionType,
          source: transaction.source,
          originChannel: transaction.originChannel,
          creatorMemberId: transaction.creatorMemberId,
          merchant: transaction.merchant,
          amountInWon: transaction.amountInWon,
          categoryId: transaction.categoryId,
          memo: transaction.memo,
          accountingDate: transaction.accountingDate,
        })),
        receipts: state.receipts.map((receipt) => ({
          idempotencyKey: receipt.idempotencyKey,
          ledgerTransactionId: receipt.ledgerTransactionId,
        })),
        outboxEvents: state.outboxEvents.map(({ eventId: _eventId, ...event }) => ({
          ...event,
          transactionId: event.transactionId,
        })),
      };
    },
  };
}

export function createRecurringProcessingAtomicityFixture() {
  const fixture = createRecurringProcessingFixture({
    now: "2026-07-18T00:00:00+09:00",
    plans: [
      {
        householdId: "house-1",
        planId: "recurring-plan-1",
        merchant: "정기 지출",
        amountInWon: 10_000,
        categoryId: "fixed",
        dayOfMonth: 18,
        memo: "정기 메모",
        active: true,
        creatorMemberId: "member-plan-creator",
        firstApplicableMonth: "2026-07",
        version: 1,
      },
    ],
  });

  return {
    async processRecurringMonth(input: {
      planId: string;
      targetMonth: string;
      idempotencyKey: string;
    }) {
      const result = await fixture.application.processMonth({
        actor: { kind: "system", capabilities: ["recurring.process"] },
        householdId: "house-1",
        planId: input.planId,
        targetMonth: input.targetMonth,
      });
      if (result.kind === "created") {
        return {
          kind: "success" as const,
          planId: result.planId,
          targetMonth: result.targetMonth,
          ledgerTransactionId: result.ledgerTransactionId,
          executionVersion: 1,
        };
      }
      if (result.kind === "already-processed") {
        return {
          kind: "already-processed" as const,
          ledgerTransactionId: result.ledgerTransactionId,
        };
      }
      if (result.kind === "retryable-failure") {
        switch (result.code) {
          case "LEDGER_TRANSACTION_SAVE_FAILED":
          case "RECURRING_CHECKPOINT_SAVE_FAILED":
          case "PROCESS_RECEIPT_SAVE_FAILED":
            return { kind: "retryable-failure" as const, code: result.code };
          default:
            throw new Error(`예상하지 못한 commit 실패 코드: ${result.code}`);
        }
      }
      throw new Error(`예상하지 못한 정기 거래 결과: ${result.reason}`);
    },
    setCommitFailureForTest(failure?: RecurringCommitFailure) {
      fixture.store.setGlobalFailure(failure);
    },
    async snapshot() {
      const state = await fixture.store.read();
      return {
        plans: state.plans.map((plan) => ({
          planId: plan.planId,
          creatorMemberId: plan.creatorMemberId,
          version: plan.version,
        })),
        executions: state.executions.map((execution) => ({
          executionKey: execution.executionKey,
          status: execution.status,
          ledgerTransactionId: execution.ledgerTransactionId,
          version: execution.version,
        })),
        ledgerTransactions: state.ledgerTransactions.map((transaction) => ({
          transactionId: transaction.transactionId,
          source: transaction.source,
          recurringPlanId: transaction.recurringPlanId,
          recurringTargetMonth: transaction.recurringTargetMonth,
          creatorMemberId: transaction.creatorMemberId,
        })),
        processReceipts: state.receipts.map((receipt) => ({
          idempotencyKey: receipt.idempotencyKey,
          ledgerTransactionId: receipt.ledgerTransactionId,
        })),
      };
    },
    async committedOutboxEvents() {
      return (await fixture.store.read()).outboxEvents;
    },
  };
}
