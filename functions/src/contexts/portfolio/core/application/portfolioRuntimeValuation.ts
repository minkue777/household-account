import {
  calculateAccountValuation,
  type PositionKind,
  type ValuationPosition,
} from "../../holdings/public";
import type {
  PortfolioRuntimeAsset,
  PortfolioRuntimeEvent,
  PortfolioRuntimePosition,
  PortfolioRuntimeState,
} from "./ports/out/portfolioRuntimeStorePort";

function signedBalance(asset: PortfolioRuntimeAsset): number {
  if (asset.lifecycleState !== "active") return 0;
  return asset.type === "loan"
    ? -Math.abs(asset.currentBalance)
    : asset.currentBalance;
}

export function valuationEvent(input: {
  readonly before?: PortfolioRuntimeAsset;
  readonly after: PortfolioRuntimeAsset;
  readonly reason: string;
  readonly occurredAt: string;
}): PortfolioRuntimeEvent {
  return {
    eventType: "AssetValuationChanged.v1",
    aggregateId: input.after.assetId,
    aggregateVersion: input.after.aggregateVersion,
    payload: {
      assetId: input.after.assetId,
      assetType: input.after.type,
      ownerRef: input.after.ownerRef,
      lifecycleState: input.after.lifecycleState,
      previousSignedBalance:
        input.before === undefined ? 0 : signedBalance(input.before),
      currentSignedBalance: signedBalance(input.after),
      valuationAsOf: input.occurredAt,
      reason: input.reason,
    },
  };
}

export function replaceAsset(
  state: PortfolioRuntimeState,
  asset: PortfolioRuntimeAsset,
): PortfolioRuntimeState {
  return {
    ...state,
    assets: state.assets.map((candidate) =>
      candidate.assetId === asset.assetId ? asset : candidate,
    ),
  };
}

function valuationPosition(position: PortfolioRuntimePosition): ValuationPosition {
  const kind: PositionKind =
    position.instrumentType === "crypto"
      ? "crypto"
      : position.instrumentType === "fund"
        ? "fund"
        : position.instrumentType === "etf"
          ? "etf"
          : position.instrumentType === "etn"
            ? "etn"
            : position.instrumentType === "cash"
              ? "cash"
              : position.instrumentType === "manual"
                ? "manual"
                : "stock";
  return {
    positionId: position.positionId,
    kind,
    quantity: position.quantity,
    averagePrice: position.averagePriceInWon,
    ...(position.lastQuote === undefined
      ? {}
      : { currentPrice: position.lastQuote.priceInWon }),
    priceScale: position.priceScale,
  };
}

export function revalueAsset(
  asset: PortfolioRuntimeAsset,
  positions: readonly PortfolioRuntimePosition[],
  occurredAt: string,
): PortfolioRuntimeAsset {
  const valuation = calculateAccountValuation(
    positions
      .filter(({ lifecycleState }) => lifecycleState === "active")
      .map(valuationPosition),
  );
  return {
    ...asset,
    currentBalance: valuation.currentBalance,
    costBasis: valuation.costBasis,
    aggregateVersion: asset.aggregateVersion + 1,
    updatedAt: occurredAt,
  };
}

export function positionEvent(input: {
  readonly operation: "added" | "updated" | "deleted" | "quote-refreshed";
  readonly before?: PortfolioRuntimePosition;
  readonly after?: PortfolioRuntimePosition;
  readonly occurredAt: string;
}): PortfolioRuntimeEvent {
  const current = input.after ?? input.before!;
  const valuation = calculateAccountValuation(
    input.after === undefined ? [] : [valuationPosition(input.after)],
  );
  return {
    eventType: "PositionChanged.v1",
    aggregateId: current.positionId,
    aggregateVersion:
      input.after?.aggregateVersion ?? current.aggregateVersion + 1,
    payload: {
      assetId: current.assetId,
      positionId: current.positionId,
      positionKind: current.positionKind,
      instrumentCode: current.instrumentCode,
      operation: input.operation,
      previousQuantity: input.before?.quantity ?? 0,
      currentQuantity: input.after?.quantity ?? 0,
      evaluatedAmountInWon: valuation.currentBalance,
      ...(input.after?.lastQuote === undefined
        ? {}
        : { quoteObservedAt: input.after.lastQuote.observedAt }),
      changedAt: input.occurredAt,
    },
  };
}
