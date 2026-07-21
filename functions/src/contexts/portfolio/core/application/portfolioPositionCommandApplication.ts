import type {
  PortfolioCommandMetadata,
  PortfolioCommandResult,
  PortfolioPositionKind,
  PortfolioRuntimePosition,
} from "./ports/out/portfolioRuntimeStorePort";
import {
  createPositionFromRaw,
  POSITION_FIELDS,
  POSITION_KINDS,
} from "./portfolioPositionPolicy";
import {
  commit,
  containsOnly,
  error,
  noWrite,
  record,
  success,
  type PortfolioAtomicExecutor,
} from "./portfolioRuntimeSupport";
import {
  positionEvent,
  revalueAsset,
  valuationEvent,
} from "./portfolioRuntimeValuation";

export interface PortfolioPositionCommands {
  addPosition(input: {
    readonly metadata: PortfolioCommandMetadata;
    readonly assetId: string;
    readonly positionKind: PortfolioPositionKind;
    readonly position: unknown;
  }): Promise<PortfolioCommandResult>;
  updatePosition(input: {
    readonly metadata: PortfolioCommandMetadata;
    readonly assetId: string;
    readonly positionId: string;
    readonly positionKind: PortfolioPositionKind;
    readonly changes: unknown;
    readonly expectedVersion?: number;
  }): Promise<PortfolioCommandResult>;
  deletePosition(input: {
    readonly metadata: PortfolioCommandMetadata;
    readonly assetId: string;
    readonly positionId: string;
    readonly positionKind: PortfolioPositionKind;
    readonly expectedVersion?: number;
  }): Promise<PortfolioCommandResult>;
}

export function createPortfolioPositionCommands(
  atomic: PortfolioAtomicExecutor,
): PortfolioPositionCommands {
  return {
    async addPosition({ metadata, assetId, positionKind, position }) {
      if (!POSITION_KINDS.has(positionKind)) {
        return error("UNSUPPORTED_POSITION_KIND");
      }
      return atomic(metadata, (state) => {
        const positionId = `position-${metadata.householdId}-${metadata.commandId}`;
        if (state.positions.some((candidate) => candidate.positionId === positionId)) {
          return noWrite(state, error("POSITION_ALREADY_EXISTS"));
        }
        const parsed = createPositionFromRaw({
          metadata,
          state,
          assetId,
          positionKind,
          raw: position,
          positionId,
        });
        if (parsed.kind === "error") return noWrite(state, error(parsed.code));
        const currentAsset = state.assets.find((asset) => asset.assetId === assetId)!;
        const positions = [...state.positions, parsed.value];
        const nextAsset = revalueAsset(
          currentAsset,
          positions.filter((candidate) => candidate.assetId === assetId),
          metadata.occurredAt,
        );
        return commit(
          {
            ...state,
            assets: state.assets.map((asset) =>
              asset.assetId === assetId ? nextAsset : asset,
            ),
            positions,
          },
          [
            positionEvent({
              operation: "added",
              after: parsed.value,
              occurredAt: metadata.occurredAt,
            }),
            valuationEvent({
              before: currentAsset,
              after: nextAsset,
              reason: "position-added",
              occurredAt: metadata.occurredAt,
            }),
          ],
          success({ positionId }),
        );
      });
    },

    async updatePosition({
      metadata,
      assetId,
      positionId,
      positionKind,
      changes,
      expectedVersion,
    }) {
      if (!POSITION_KINDS.has(positionKind)) {
        return error("UNSUPPORTED_POSITION_KIND");
      }
      const raw = record(changes);
      if (raw === undefined || !containsOnly(raw, POSITION_FIELDS)) {
        return error("INVALID_POSITION_PATCH");
      }
      if (
        raw.assetId !== undefined &&
        (typeof raw.assetId !== "string" || raw.assetId !== assetId)
      ) {
        return error("ASSET_SCOPE_MISMATCH");
      }
      return atomic(metadata, (state) => {
        const current = state.positions.find(
          (position) => position.positionId === positionId,
        );
        const asset = state.assets.find((candidate) => candidate.assetId === assetId);
        if (asset === undefined) return noWrite(state, error("ASSET_NOT_FOUND"));
        if (asset.lifecycleState !== "active") {
          return noWrite(state, error("ASSET_NOT_ACTIVE"));
        }
        if (
          current === undefined ||
          current.assetId !== assetId ||
          current.positionKind !== positionKind ||
          current.lifecycleState !== "active"
        ) {
          return noWrite(state, error("POSITION_NOT_FOUND"));
        }
        if (
          expectedVersion !== undefined &&
          expectedVersion !== current.aggregateVersion
        ) {
          return noWrite(state, error("POSITION_VERSION_MISMATCH"));
        }
        const mergedRaw: Record<string, unknown> = {
          assetId,
          ...(positionKind === "stock"
            ? {
                holdingType: current.holdingType,
                stockCode: current.instrumentCode,
                stockName: current.instrumentName,
                instrumentType: current.instrumentType,
                market: current.market,
                exchange: current.exchange,
                currency: current.currency,
              }
            : {
                marketCode: current.instrumentCode,
                coinName: current.instrumentName,
                instrumentType: "crypto",
                market: current.market,
                currency: current.currency,
              }),
          quantity: current.quantity,
          avgPrice: current.averagePriceInWon,
          ...(current.lastQuote === undefined
            ? {}
            : { currentPrice: current.lastQuote.priceInWon }),
          priceScale: current.priceScale,
          ...(current.quoteAsOf === undefined
            ? {}
            : { quoteAsOf: current.quoteAsOf }),
          ...raw,
        };
        const parsed = createPositionFromRaw({
          metadata,
          state,
          assetId,
          positionKind,
          raw: mergedRaw,
          positionId,
        });
        if (parsed.kind === "error") return noWrite(state, error(parsed.code));
        const updated: PortfolioRuntimePosition = {
          ...parsed.value,
          aggregateVersion: current.aggregateVersion + 1,
          createdAt: current.createdAt,
          updatedAt: metadata.occurredAt,
        };
        const positions = state.positions.map((position) =>
          position.positionId === positionId ? updated : position,
        );
        const nextAsset = revalueAsset(
          asset,
          positions.filter((position) => position.assetId === assetId),
          metadata.occurredAt,
        );
        return commit(
          {
            ...state,
            assets: state.assets.map((candidate) =>
              candidate.assetId === assetId ? nextAsset : candidate,
            ),
            positions,
          },
          [
            positionEvent({
              operation: "updated",
              before: current,
              after: updated,
              occurredAt: metadata.occurredAt,
            }),
            valuationEvent({
              before: asset,
              after: nextAsset,
              reason: "position-updated",
              occurredAt: metadata.occurredAt,
            }),
          ],
          success({}),
        );
      });
    },

    async deletePosition({
      metadata,
      assetId,
      positionId,
      positionKind,
      expectedVersion,
    }) {
      if (!POSITION_KINDS.has(positionKind)) {
        return error("UNSUPPORTED_POSITION_KIND");
      }
      return atomic(metadata, (state) => {
        const asset = state.assets.find((candidate) => candidate.assetId === assetId);
        const current = state.positions.find(
          (position) => position.positionId === positionId,
        );
        if (asset === undefined) return noWrite(state, error("ASSET_NOT_FOUND"));
        if (asset.lifecycleState !== "active") {
          return noWrite(state, error("ASSET_NOT_ACTIVE"));
        }
        if (
          current === undefined ||
          current.assetId !== assetId ||
          current.positionKind !== positionKind ||
          current.lifecycleState !== "active"
        ) {
          return noWrite(state, error("POSITION_NOT_FOUND"));
        }
        if (
          expectedVersion !== undefined &&
          expectedVersion !== current.aggregateVersion
        ) {
          return noWrite(state, error("POSITION_VERSION_MISMATCH"));
        }
        const deleted: PortfolioRuntimePosition = {
          ...current,
          lifecycleState: "deleted",
          aggregateVersion: current.aggregateVersion + 1,
          updatedAt: metadata.occurredAt,
        };
        const positions = state.positions.map((position) =>
          position.positionId === positionId ? deleted : position,
        );
        const nextAsset = revalueAsset(
          asset,
          positions.filter((position) => position.assetId === assetId),
          metadata.occurredAt,
        );
        return commit(
          {
            ...state,
            assets: state.assets.map((candidate) =>
              candidate.assetId === assetId ? nextAsset : candidate,
            ),
            positions,
          },
          [
            positionEvent({
              operation: "deleted",
              before: current,
              occurredAt: metadata.occurredAt,
            }),
            valuationEvent({
              before: asset,
              after: nextAsset,
              reason: "position-deleted",
              occurredAt: metadata.occurredAt,
            }),
          ],
          success({}),
        );
      });
    },
  };
}
