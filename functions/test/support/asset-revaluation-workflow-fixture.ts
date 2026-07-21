import { createAssetRevaluationWorkflow } from "../../src/contexts/portfolio/holdings/application/assetRevaluationWorkflow";
import type {
  AssetRevaluationUnitOfWork,
  RevaluationDecision,
} from "../../src/contexts/portfolio/holdings/application/ports/out/assetRevaluationUnitOfWork";
import type {
  RevaluationPortfolioEvent,
  RevaluationResult,
  RevaluationState,
  RevaluedAssetView,
  RevaluedPositionView,
} from "../../src/contexts/portfolio/holdings/domain/model/assetRevaluation";

function copyState(state: RevaluationState): RevaluationState {
  return {
    asset: { ...state.asset },
    positions: state.positions.map((position) => ({ ...position })),
    receipts: Object.fromEntries(
      Object.entries(state.receipts).map(([key, receipt]) => [
        key,
        { ...receipt, result: structuredClone(receipt.result) },
      ]),
    ),
  };
}

export function createAssetRevaluationWorkflowFixture(fixture: {
  asset: RevaluedAssetView;
  positions?: readonly RevaluedPositionView[];
  transactionMayRetryCallback?: boolean;
  failCommit?: boolean;
}) {
  let state: RevaluationState = {
    asset: { ...fixture.asset },
    positions: (fixture.positions ?? []).map((position) => ({ ...position })),
    receipts: {},
  };
  const events: RevaluationPortfolioEvent[] = [];
  let queue: Promise<void> = Promise.resolve();

  const unitOfWork: AssetRevaluationUnitOfWork = {
    transact: (decide) => {
      let resolveResult!: (result: RevaluationResult) => void;
      const result = new Promise<RevaluationResult>((resolve) => {
        resolveResult = resolve;
      });
      queue = queue.then(() => {
        const snapshot = copyState(state);
        if (fixture.transactionMayRetryCallback) decide(copyState(snapshot));
        const decision: RevaluationDecision = decide(copyState(snapshot));
        if (decision.kind === "return") {
          resolveResult(structuredClone(decision.result));
          return;
        }
        if (fixture.failCommit) {
          resolveResult({
            kind: "retryable-failure",
            code: "UOW_RETRY_EXHAUSTED",
          });
          return;
        }
        state = copyState(decision.nextState);
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
    events: () => events.map((event) => ({ ...event })),
  };
  return createAssetRevaluationWorkflow(unitOfWork);
}
