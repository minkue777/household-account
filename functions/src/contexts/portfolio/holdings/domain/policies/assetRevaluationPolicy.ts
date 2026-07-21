import type {
  RevaluationCommand,
  RevaluedAssetView,
  RevaluedPositionView,
} from "../model/assetRevaluation";
import { calculateAccountValuationPolicy } from "./accountValuation";

export function revaluationCommandFingerprint(
  command: RevaluationCommand,
): string {
  return JSON.stringify({
    householdId: command.householdId,
    assetId: command.assetId,
    expectedAssetVersion: command.expectedAssetVersion,
    operation: command.operation,
    positionId: command.positionId,
    expectedPositionVersion: command.expectedPositionVersion,
    quantity: command.quantity,
    averagePrice: command.averagePrice,
    evaluatedPrice: command.evaluatedPrice,
  });
}

export function applyPositionMutation(input: {
  command: RevaluationCommand;
  positions: readonly RevaluedPositionView[];
}): {
  positions: readonly RevaluedPositionView[];
  changedPosition?: RevaluedPositionView;
  changedPositionVersion: number;
} | undefined {
  const existing = input.positions.find(
    ({ positionId }) => positionId === input.command.positionId,
  );
  if (input.command.operation === "add") {
    if (existing !== undefined) return undefined;
    const position: RevaluedPositionView = {
      positionId: input.command.positionId,
      assetId: input.command.assetId,
      quantity: input.command.quantity ?? 0,
      averagePrice: input.command.averagePrice ?? 0,
      evaluatedPrice: input.command.evaluatedPrice ?? 0,
      evaluatedAmount:
        (input.command.quantity ?? 0) * (input.command.evaluatedPrice ?? 0),
      aggregateVersion: 1,
    };
    return {
      positions: [...input.positions, position],
      changedPosition: position,
      changedPositionVersion: position.aggregateVersion,
    };
  }

  if (
    existing === undefined ||
    input.command.expectedPositionVersion !== existing.aggregateVersion
  ) {
    return undefined;
  }
  if (input.command.operation === "delete") {
    return {
      positions: input.positions.filter(
        ({ positionId }) => positionId !== existing.positionId,
      ),
      changedPositionVersion: existing.aggregateVersion + 1,
    };
  }

  const position: RevaluedPositionView = {
    ...existing,
    quantity: input.command.quantity ?? existing.quantity,
    averagePrice: input.command.averagePrice ?? existing.averagePrice,
    evaluatedPrice: input.command.evaluatedPrice ?? existing.evaluatedPrice,
    evaluatedAmount:
      (input.command.quantity ?? existing.quantity) *
      (input.command.evaluatedPrice ?? existing.evaluatedPrice),
    aggregateVersion: existing.aggregateVersion + 1,
  };
  return {
    positions: input.positions.map((item) =>
      item.positionId === position.positionId ? position : item,
    ),
    changedPosition: position,
    changedPositionVersion: position.aggregateVersion,
  };
}

export function revalueAssetFromPositions(input: {
  asset: RevaluedAssetView;
  positions: readonly RevaluedPositionView[];
}): RevaluedAssetView {
  const valuation = calculateAccountValuationPolicy(
    input.positions.map((position) => ({
      positionId: position.positionId,
      kind: "stock" as const,
      quantity: position.quantity,
      averagePrice: position.averagePrice,
      currentPrice: position.evaluatedPrice,
      priceScale: 1,
    })),
  );
  return {
    ...input.asset,
    currentBalance: valuation.currentBalance,
    costBasis: valuation.costBasis,
    aggregateVersion: input.asset.aggregateVersion + 1,
  };
}
