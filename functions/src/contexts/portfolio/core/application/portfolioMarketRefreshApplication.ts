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
      if (lease.kind === "rate-limited") return error("MARKET_REFRESH_RATE_LIMITED", true);
      if (lease.kind === "payload-mismatch") {
        return error("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      if (lease.kind === "busy") {
        return success({
          refreshedCount: 0,
          targetCount: 0,
          retainedLastSuccessCount: 0,
          failedCount: 0,
          skippedReason: "MARKET_REFRESH_IN_PROGRESS",
        });
      }
      if (lease.kind === "failed") return error("PORTFOLIO_UOW_FAILED", true);

      try {
        const snapshot = await dependencies.store.readState(metadata.householdId, { assetId, automationPlans: false });
        const targets = marketTargets(snapshot, assetClass, assetId);
        const completedTargetKeys = new Set(lease.completedTargetKeys ?? []);
        const pendingTargets = targets.filter(target => !completedTargetKeys.has(target.targetKey));
        const results = new Map<string, PortfolioMarketQuoteResult>();
        const executions: {
          target: PortfolioMarketTarget;
          result: PortfolioMarketQuoteResult;
          attempts: readonly {
            readonly result: PortfolioMarketQuoteResult;
            readonly latencyMs: number;
          }[];
        }[] = [];
        const quoteKey = (target: PortfolioMarketTarget) => `${target.market}\u0000${target.instrumentCode}`;
        const uniqueTargets = new Map<string, PortfolioMarketTarget>();
        for (const target of pendingTargets) {
          if (!uniqueTargets.has(quoteKey(target))) uniqueTargets.set(quoteKey(target), target);
        }
        const quoteTargets = [...uniqueTargets.values()];
        const quoted = new Map<string, Awaited<ReturnType<typeof quoteWithRetries>>>();
        // Workers and page boundaries belong to provider quotes, not positions:
        // repeated holdings must not occupy slots or re-fetch across pages.
        for (let offset = 0; offset < quoteTargets.length; offset += 50) {
          const pageResults = await withConcurrency(quoteTargets.slice(offset, offset + 50), 5, async target => ({
            target,
            execution: await quoteWithRetries(dependencies.marketQuotes, target),
          }));
          for (const { target, execution } of pageResults) quoted.set(quoteKey(target), execution);
        }
        for (const target of pendingTargets) {
          const execution = quoted.get(quoteKey(target))!;
          results.set(target.targetKey, execution.result);
          executions.push({ target, ...execution });
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
        const failedCount = executions.filter(execution => execution.result.kind === "failure").length - retainedLastSuccessCount;
        for (const target of pendingTargets) {
          const result = results.get(target.targetKey);
          if (result?.kind === "success" || (result?.kind === "failure" && (
            target.positionId !== undefined
              ? snapshot.positions.some(position => position.positionId === target.positionId && position.lastQuote !== undefined)
              : snapshot.assets.some(asset => asset.assetId === target.assetId && asset.currentBalance > 0)
          ))) completedTargetKeys.add(target.targetKey);
        }
        const failedTargets = pendingTargets.flatMap(target => {
          const result = results.get(target.targetKey);
          return result?.kind === "failure" && !completedTargetKeys.has(target.targetKey)
            ? [{ targetKey: target.targetKey, assetId: target.assetId, ...(target.positionId === undefined ? {} : { positionId: target.positionId }), code: result.code, retryable: result.retryable }]
            : [];
        });

        return await dependencies.atomic(metadata, (state) => {
          if (targets.some(target => {
            const beforeAsset = snapshot.assets.find(asset => asset.assetId === target.assetId);
            const currentAsset = state.assets.find(asset => asset.assetId === target.assetId);
            if (beforeAsset?.aggregateVersion !== currentAsset?.aggregateVersion) return true;
            if (target.positionId === undefined) return false;
            return snapshot.positions.find(position => position.positionId === target.positionId)?.aggregateVersion !== state.positions.find(position => position.positionId === target.positionId)?.aggregateVersion;
          })) return noWrite(state, error("VALUATION_VERSION_MISMATCH", true));
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
              failedCount,
              ...(failedCount > 0 ? { completedTargetKeys: [...completedTargetKeys], failedTargets, retryCommandId: metadata.commandId } : {}),
            }),
          );
        }, { assetId, automationPlans: false });
      } catch {
        return error("MARKET_REFRESH_FAILED", true);
      } finally {
        await dependencies.store.releaseRefreshLease(metadata, scopeKey);
      }
    },
  };
}
