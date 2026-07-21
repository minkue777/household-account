import { createPositionMutationLifecycleApplication } from "../../src/contexts/portfolio/holdings/application/positionMutationLifecycleApplication";
import type {
  PositionMutationDecision,
  PositionMutationUnitOfWork,
} from "../../src/contexts/portfolio/holdings/application/ports/out/positionMutationUnitOfWork";
import type {
  PositionAccountState,
  PositionMutationEvent,
  PositionMutationReceipt,
  PositionMutationResult,
  PositionState,
} from "../../src/contexts/portfolio/holdings/public";
import type { PositionMutationState } from "../../src/contexts/portfolio/holdings/domain/model/positionMutation";

function copyState(state: PositionMutationState): PositionMutationState {
  return {
    asset: { ...state.asset },
    positions: state.positions.map((position) => ({ ...position })),
    receipts: structuredClone(state.receipts),
  };
}

export function createPositionMutationLifecycleFixture(fixture: {
  asset: PositionAccountState;
  positions: readonly PositionState[];
  failParticipant?: "position" | "asset" | "receipt" | "outbox";
  transactionMayRetryCallback?: boolean;
}) {
  let state: PositionMutationState = {
    asset: { ...fixture.asset },
    positions: fixture.positions.map((position) => ({ ...position })),
    receipts: {},
  };
  const receipts: PositionMutationReceipt[] = [];
  const events: PositionMutationEvent[] = [];
  let queue: Promise<void> = Promise.resolve();

  const unitOfWork: PositionMutationUnitOfWork = {
    transact: (decide) => {
      let resolveResult!: (value: PositionMutationResult) => void;
      const result = new Promise<PositionMutationResult>((resolve) => {
        resolveResult = resolve;
      });
      queue = queue.then(() => {
        const snapshot = copyState(state);
        if (fixture.transactionMayRetryCallback) decide(copyState(snapshot));
        const decision: PositionMutationDecision = decide(copyState(snapshot));
        if (decision.kind === "return") {
          resolveResult(structuredClone(decision.result));
          return;
        }
        if (fixture.failParticipant !== undefined) {
          resolveResult({
            kind: "retryable-failure",
            code: "PORTFOLIO_UOW_FAILED",
          });
          return;
        }
        state = copyState(decision.state);
        receipts.push({ ...decision.receipt });
        events.push(...decision.events.map((event) => ({ ...event })));
        resolveResult(structuredClone(decision.result));
      });
      return result;
    },
    asset: async (assetId) => {
      if (state.asset.assetId !== assetId) {
        throw new Error(`자산을 찾을 수 없습니다: ${assetId}`);
      }
      return { ...state.asset };
    },
    positions: async (assetId) =>
      state.positions
        .filter((position) => position.assetId === assetId)
        .map((position) => ({ ...position })),
    receipts: () => receipts.map((receipt) => ({ ...receipt })),
    events: () => events.map((event) => ({ ...event })),
  };
  return createPositionMutationLifecycleApplication(unitOfWork);
}
