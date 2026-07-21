import { createLoanRepaymentWorkflowApplication } from "../../src/contexts/portfolio/automation/application/loanRepaymentWorkflowApplication";
import type {
  LoanRepaymentDecision,
  LoanRepaymentState,
  LoanRepaymentStore,
} from "../../src/contexts/portfolio/automation/application/ports/out/loanRepaymentStore";
import type {
  AutomationAppliedEvent,
  LoanPlan,
  RunRepaymentResult,
} from "../../src/contexts/portfolio/automation/public";

function copyState(state: LoanRepaymentState): LoanRepaymentState {
  return structuredClone(state);
}

export function createLoanRepaymentWorkflowFixture(seed: {
  plan: LoanPlan;
  existingExecution?: { targetMonth: string; executionId: string };
}) {
  let state: LoanRepaymentState = {
    plan: { ...seed.plan },
    executionsByMonth:
      seed.existingExecution === undefined
        ? {}
        : {
            [seed.existingExecution.targetMonth]:
              seed.existingExecution.executionId,
          },
    receipts: {},
  };
  const events: AutomationAppliedEvent[] = [];
  let queue: Promise<void> = Promise.resolve();
  const store: LoanRepaymentStore = {
    state: () => copyState(state),
    transact: (decide) => {
      let resolveResult!: (result: RunRepaymentResult) => void;
      const result = new Promise<RunRepaymentResult>((resolve) => {
        resolveResult = resolve;
      });
      queue = queue.then(() => {
        const decision: LoanRepaymentDecision = decide(copyState(state));
        if (decision.kind === "return") {
          resolveResult(structuredClone(decision.result));
          return;
        }
        state = copyState(decision.state);
        events.push({ ...decision.event });
        resolveResult(structuredClone(decision.result));
      });
      return result;
    },
    executionIds: () => Object.values(state.executionsByMonth),
    events: () => events.map((event) => ({ ...event })),
  };
  return createLoanRepaymentWorkflowApplication(store);
}
