import type {
  PortfolioCommandMetadata,
  PortfolioCommandResult,
  PortfolioMarketQuotePort,
  PortfolioMarketQuoteResult,
  PortfolioMarketTarget,
  PortfolioProviderHealthPort,
  PortfolioRuntimeEvent,
  PortfolioRuntimePosition,
  PortfolioRuntimeStorePort,
} from "./ports/out/portfolioRuntimeStorePort";
import {
  commit,
  error,
  noWrite,
  success,
  type PortfolioAtomicExecutor,
} from "./portfolioRuntimeSupport";
import {
  positionEvent,
  revalueAsset,
  valuationEvent,
} from "./portfolioRuntimeValuation";
import {
  marketTargets,
  providerObservations,
  quoteWithRetries,
  withConcurrency,
} from "./portfolioMarketRefreshPolicy";

export interface PortfolioMarketRefreshCommand {
  refreshMarketValues(input: {
    readonly metadata: PortfolioCommandMetadata;
    readonly assetClass: "stock" | "crypto" | "physical-gold" | "all";
    readonly assetId?: string;
  }): Promise<PortfolioCommandResult>;
}

export function createPortfolioMarketRefreshCommand(dependencies: {
  readonly atomic: PortfolioAtomicExecutor;
  readonly store: PortfolioRuntimeStorePort;
  readonly marketQuotes: PortfolioMarketQuotePort;
  readonly providerHealth?: PortfolioProviderHealthPort;
}): PortfolioMarketRefreshCommand {
  return {
    async refreshMarketValues({ metadata, assetClass, assetId }) {
      const scopeKey = assetId === undefined ? "household" : `asset:${assetId}`;
      const lease = await dependencies.store.acquireRefreshLease(metadata, scopeKey);
      if (lease.kind === "replayed") return lease.value;
      if (lease.kind === "payload-mismatch") {
        return error("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      if (lease.kind === "busy") return error("MARKET_REFRESH_IN_PROGRESS", true);
      if (lease.kind === "failed") return error("PORTFOLIO_UOW_FAILED", true);

      try {
        const snapshot = await dependencies.store.readState(metadata.householdId);
        const targets = marketTargets(snapshot, assetClass, assetId);
        const results = new Map<string, PortfolioMarketQuoteResult>();
        const executions: {
          target: PortfolioMarketTarget;
          result: PortfolioMarketQuoteResult;
          attempts: readonly {
            readonly result: PortfolioMarketQuoteResult;
            readonly latencyMs: number;
          }[];
        }[] = [];
        for (let offset = 0; offset < targets.length; offset += 50) {
          const page = targets.slice(offset, offset + 50);
          const quoteCache = new Map<string, ReturnType<typeof quoteWithRetries>>();
          const pageResults = await withConcurrency(page, 5, async (target) => {
            const cacheKey = `${target.market}\u0000${target.instrumentCode}`;
            let pending = quoteCache.get(cacheKey);
            if (pending === undefined) {
              pending = quoteWithRetries(dependencies.marketQuotes, target);
              quoteCache.set(cacheKey, pending);
            }
            return { target, execution: await pending };
          });
          for (const { target, execution } of pageResults) {
            results.set(target.targetKey, execution.result);
            executions.push({ target, ...execution });
          }
        }
        if (dependencies.providerHealth !== undefined) {
          await Promise.allSettled(
            providerObservations({ metadata, scopeKey, executions }).map(
              (observation) => dependencies.providerHealth!.recordRun(observation),
            ),
          );
        }
        const retainedLastSuccessCount = targets.filter((target) => {
          if (results.get(target.targetKey)?.kind !== "failure") return false;
          if (target.positionId !== undefined) {
            return snapshot.positions.some(
              (position) =>
                position.positionId === target.positionId &&
                position.lastQuote !== undefined,
            );
          }
          return snapshot.assets.some(
            (asset) => asset.assetId === target.assetId && asset.currentBalance > 0,
          );
        }).length;

        return dependencies.atomic(metadata, (state) => {
          if (assetId !== undefined) {
            const scopedAsset = state.assets.find(
              (candidate) => candidate.assetId === assetId,
            );
            if (scopedAsset === undefined) {
              return noWrite(state, error("ASSET_NOT_FOUND"));
            }
            if (scopedAsset.lifecycleState !== "active") {
              return noWrite(state, error("ASSET_NOT_ACTIVE"));
            }
          }
          const beforeAssets = new Map(
            state.assets.map((asset) => [asset.assetId, asset]),
          );
          let positions = [...state.positions];
          const changedPositionIds = new Set<string>();
          const directlyChangedAssets = new Set<string>();
          const events: PortfolioRuntimeEvent[] = [];
          let refreshedCount = 0;

          for (const target of marketTargets(state, assetClass, assetId)) {
            const result = results.get(target.targetKey);
            if (result?.kind !== "success") continue;
            if (target.positionId !== undefined) {
              const index = positions.findIndex(
                (position) =>
                  position.positionId === target.positionId &&
                  position.assetId === target.assetId &&
                  position.lifecycleState === "active" &&
                  position.instrumentCode === target.instrumentCode,
              );
              if (index < 0) continue;
              const current = positions[index];
              const updated: PortfolioRuntimePosition = {
                ...current,
                lastQuote: { ...result.quote },
                ...(result.quoteAsOf === undefined
                  ? {}
                  : { quoteAsOf: result.quoteAsOf }),
                aggregateVersion: current.aggregateVersion + 1,
                updatedAt: metadata.occurredAt,
              };
              positions[index] = updated;
              changedPositionIds.add(updated.positionId);
              refreshedCount += 1;
              events.push(
                positionEvent({
                  operation: "quote-refreshed",
                  before: current,
                  after: updated,
                  occurredAt: metadata.occurredAt,
                }),
              );
              continue;
            }

            const asset = beforeAssets.get(target.assetId);
            if (
              asset === undefined ||
              asset.lifecycleState !== "active" ||
              asset.type !== "gold" ||
              asset.subType !== "physical" ||
              asset.quantity === undefined
            ) {
              continue;
            }
            directlyChangedAssets.add(asset.assetId);
            refreshedCount += 1;
          }

          const positionAssetIds = new Set(
            positions
              .filter((position) => changedPositionIds.has(position.positionId))
              .map(({ assetId }) => assetId),
          );
          const assets = state.assets.map((asset) => {
            if (positionAssetIds.has(asset.assetId)) {
              return revalueAsset(
                asset,
                positions.filter((position) => position.assetId === asset.assetId),
                metadata.occurredAt,
              );
            }
            if (directlyChangedAssets.has(asset.assetId)) {
              const target = marketTargets(state, assetClass, assetId).find(
                (candidate) =>
                  candidate.assetId === asset.assetId &&
                  candidate.kind === "physical-gold",
              );
              const result =
                target === undefined ? undefined : results.get(target.targetKey);
              if (
                target === undefined ||
                result?.kind !== "success" ||
                asset.quantity === undefined
              ) {
                return asset;
              }
              return {
                ...asset,
                currentBalance: Math.round(
                  (asset.quantity * result.quote.priceInWon) / target.priceScale,
                ),
                aggregateVersion: asset.aggregateVersion + 1,
                updatedAt: metadata.occurredAt,
              };
            }
            return asset;
          });
          for (const asset of assets) {
            const before = beforeAssets.get(asset.assetId);
            if (
              before !== undefined &&
              before.aggregateVersion !== asset.aggregateVersion
            ) {
              events.push(
                valuationEvent({
                  before,
                  after: asset,
                  reason: "market-refresh",
                  occurredAt: metadata.occurredAt,
                }),
              );
            }
          }
          return commit(
            { ...state, assets, positions },
            events,
            success({
              refreshedCount,
              targetCount: targets.length,
              retainedLastSuccessCount,
            }),
          );
        });
      } catch {
        return error("MARKET_REFRESH_FAILED", true);
      } finally {
        await dependencies.store.releaseRefreshLease(metadata, scopeKey);
      }
    },
  };
}
