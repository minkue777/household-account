import type {
  RevaluationPortfolioEvent,
  RevaluationResult,
} from "../domain/model/assetRevaluation";
import {
  applyPositionMutation,
  revaluationCommandFingerprint,
  revalueAssetFromPositions,
} from "../domain/policies/assetRevaluationPolicy";
import type { AssetRevaluationWorkflow } from "./ports/in/assetRevaluation";
import type { AssetRevaluationUnitOfWork } from "./ports/out/assetRevaluationUnitOfWork";

export function createAssetRevaluationWorkflow(
  unitOfWork: AssetRevaluationUnitOfWork,
): AssetRevaluationWorkflow {
  return {
    execute: (command) =>
      unitOfWork.transact((state) => {
        const fingerprint = revaluationCommandFingerprint(command);
        const receipt = state.receipts[command.idempotencyKey];
        if (receipt !== undefined) {
          return {
            kind: "return",
            result:
              receipt.fingerprint === fingerprint
                ? receipt.result
                : {
                    kind: "conflict",
                    code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
                  },
          };
        }
        if (
          state.asset.assetId !== command.assetId ||
          state.asset.aggregateVersion !== command.expectedAssetVersion
        ) {
          return {
            kind: "return",
            result: {
              kind: "conflict",
              code: "REVALUATION_VERSION_MISMATCH",
            },
          };
        }

        const mutation = applyPositionMutation({
          command,
          positions: state.positions,
        });
        if (mutation === undefined) {
          return {
            kind: "return",
            result: {
              kind: "conflict",
              code: "REVALUATION_VERSION_MISMATCH",
            },
          };
        }
        const asset = revalueAssetFromPositions({
          asset: state.asset,
          positions: mutation.positions,
        });
        const result: RevaluationResult = {
          kind: "success",
          asset,
          ...(mutation.changedPosition === undefined
            ? {}
            : { position: mutation.changedPosition }),
        };
        const events: RevaluationPortfolioEvent[] = [
          {
            eventType: "PositionChanged.v1",
            aggregateId: command.positionId,
            aggregateVersion: mutation.changedPositionVersion,
            assetId: command.assetId,
          },
          {
            eventType: "AssetValuationChanged.v1",
            aggregateId: command.assetId,
            aggregateVersion: asset.aggregateVersion,
            currentSignedBalance: asset.currentBalance,
          },
        ];
        return {
          kind: "commit",
          nextState: {
            asset,
            positions: mutation.positions,
            receipts: {
              ...state.receipts,
              [command.idempotencyKey]: { fingerprint, result },
            },
          },
          events,
          result,
        };
      }),
    queryAsset: (assetId) => unitOfWork.asset(assetId),
    listPositions: (assetId) => unitOfWork.positions(assetId),
    recordedEvents: () => unitOfWork.events(),
  };
}
