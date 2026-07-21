import { createRecurringCategoryRemapApplication } from "../../src/contexts/household-finance/recurring/application/recurringCategoryRemapApplication";
import type { RecurringCategoryRemapUnitOfWork } from "../../src/contexts/household-finance/recurring/application/ports/out/recurringCategoryRemapPorts";
import type {
  CategoryRemapResult,
  HistoricalLedgerCategoryState,
  RecurringCategoryPlanState,
  RecurringCategoryRemapDecision,
  RecurringCategoryRemapState,
} from "../../src/contexts/household-finance/recurring/domain/model/recurringCategoryRemap";

export type { HistoricalLedgerCategoryState, RecurringCategoryPlanState };

class FixtureRecurringCategoryRemapStore
  implements RecurringCategoryRemapUnitOfWork
{
  private stateValue: RecurringCategoryRemapState;
  private readonly failingPlanIds: Set<string>;

  constructor(input: {
    plans: readonly RecurringCategoryPlanState[];
    historicalLedgerTransactions?: readonly HistoricalLedgerCategoryState[];
    failPlanIds?: readonly string[];
  }) {
    this.stateValue = {
      plans: input.plans.map((plan) => ({ ...plan })),
      historicalLedgerTransactions: (
        input.historicalLedgerTransactions ?? []
      ).map((transaction) => ({ ...transaction })),
      receipts: [],
      events: [],
    };
    this.failingPlanIds = new Set(input.failPlanIds ?? []);
  }

  async transact(
    retryCursor: string | undefined,
    decide: (
      state: RecurringCategoryRemapState,
    ) => RecurringCategoryRemapDecision,
  ): Promise<CategoryRemapResult> {
    const decision = decide(structuredClone(this.stateValue));
    if (decision.kind === "return") return structuredClone(decision.result);
    if (
      decision.selectedPlanIds.some((planId) =>
        this.failingPlanIds.has(planId),
      )
    ) {
      return {
        kind: "retryable-failure",
        code: "RECURRING_CATEGORY_REMAP_PAGE_FAILED",
        ...(retryCursor === undefined ? {} : { retryCursor }),
      };
    }
    this.stateValue = structuredClone(decision.nextState);
    return structuredClone(decision.result);
  }

  async read(): Promise<RecurringCategoryRemapState> {
    return structuredClone(this.stateValue);
  }

  clearFailure(planId: string): void {
    this.failingPlanIds.delete(planId);
  }
}

function hash(value: string): string {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return `sha256:${(result >>> 0).toString(16)}`;
}

export function createRecurringCategoryRemapFixture(input: {
  plans: readonly RecurringCategoryPlanState[];
  historicalLedgerTransactions?: readonly HistoricalLedgerCategoryState[];
  failPlanIds?: readonly string[];
}) {
  const store = new FixtureRecurringCategoryRemapStore(input);
  const application = createRecurringCategoryRemapApplication({
    unitOfWork: store,
    hash: { hash },
  });
  return {
    remap: (command: Parameters<typeof application.remap>[0]) =>
      application.remap(command),
    clearPlanFailureForTest: (planId: string) => store.clearFailure(planId),
    async snapshot() {
      const state = await store.read();
      return {
        plans: state.plans,
        historicalLedgerTransactions: state.historicalLedgerTransactions,
        receipts: state.receipts.map((receipt) => ({
          receiptKey: receipt.receiptKey,
          payloadHash: receipt.payloadHash,
          changedPlanIds: receipt.changedPlanIds,
          nextCursor: receipt.page.nextCursor,
        })),
        events: state.events,
      };
    },
  };
}
