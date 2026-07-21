import type {
  DeletePositionCommand,
  PositionMutationEvent,
  PositionMutationReceipt,
  PositionMutationResult,
  UpdatePositionCommand,
} from "../domain/model/positionMutation";
import { calculatePositionAccountState } from "../domain/policies/positionMutationPolicy";
import type { PositionMutationLifecycle } from "./ports/in/positionMutationLifecycle";
import type { PositionMutationUnitOfWork } from "./ports/out/positionMutationUnitOfWork";

export function createPositionMutationLifecycleApplication(
  unitOfWork: PositionMutationUnitOfWork,
): PositionMutationLifecycle {
  function execute(
    command: UpdatePositionCommand | DeletePositionCommand,
    operation: "update" | "delete",
  ): Promise<PositionMutationResult> {
    return unitOfWork.transact((state) => {
      const replay = state.receipts[command.idempotencyKey];
      if (replay !== undefined) return { kind: "return", result: replay };
      if (
        state.asset.assetId !== command.assetId ||
        state.asset.aggregateVersion !== command.expectedAssetVersion
      ) {
        return {
          kind: "return",
          result: { kind: "conflict", code: "ASSET_VERSION_MISMATCH" },
        };
      }
      const current = state.positions.find(
        ({ positionId }) => positionId === command.positionId,
      );
      if (
        current === undefined ||
        current.aggregateVersion !== command.expectedPositionVersion
      ) {
        return {
          kind: "return",
          result: { kind: "conflict", code: "POSITION_VERSION_MISMATCH" },
        };
      }

      const nextPosition =
        operation === "update"
          ? {
              ...current,
              quantity: (command as UpdatePositionCommand).quantity,
              averagePriceInWon: (command as UpdatePositionCommand)
                .averagePriceInWon,
              evaluatedPriceInWon: (command as UpdatePositionCommand)
                .evaluatedPriceInWon,
              aggregateVersion: current.aggregateVersion + 1,
            }
          : undefined;
      const positions =
        nextPosition === undefined
          ? state.positions.filter(
              ({ positionId }) => positionId !== command.positionId,
            )
          : state.positions.map((position) =>
              position.positionId === nextPosition.positionId
                ? nextPosition
                : position,
            );
      const asset = calculatePositionAccountState({
        current: state.asset,
        positions,
      });
      const receipt: PositionMutationReceipt = {
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        operation,
        positionId: command.positionId,
        resultingAssetVersion: asset.aggregateVersion,
        ...(nextPosition === undefined
          ? {}
          : { resultingPositionVersion: nextPosition.aggregateVersion }),
      };
      const result: PositionMutationResult = {
        kind: "success",
        asset,
        ...(nextPosition === undefined ? {} : { position: nextPosition }),
        receipt,
      };
      const positionEvent: PositionMutationEvent =
        nextPosition === undefined
          ? {
              eventType: "PositionRemoved.v1",
              positionId: command.positionId,
              aggregateVersion: current.aggregateVersion + 1,
            }
          : {
              eventType: "PositionChanged.v1",
              operation: "updated",
              positionId: command.positionId,
              aggregateVersion: nextPosition.aggregateVersion,
            };
      const events: PositionMutationEvent[] = [
        positionEvent,
        {
          eventType: "AssetValuationChanged.v1",
          assetId: asset.assetId,
          aggregateVersion: asset.aggregateVersion,
          currentSignedBalance: asset.currentBalanceInWon,
          costBasisInWon: asset.costBasisInWon,
        },
      ];
      return {
        kind: "commit",
        state: {
          asset,
          positions,
          receipts: {
            ...state.receipts,
            [command.idempotencyKey]: result,
          },
        },
        receipt,
        events,
        result,
      };
    });
  }

  return {
    update: (command) => execute(command, "update"),
    delete: (command) => execute(command, "delete"),
    queryAsset: (assetId) => unitOfWork.asset(assetId),
    listPositions: (assetId) => unitOfWork.positions(assetId),
    receipts: () => unitOfWork.receipts(),
    recordedEvents: () => unitOfWork.events(),
  };
}
