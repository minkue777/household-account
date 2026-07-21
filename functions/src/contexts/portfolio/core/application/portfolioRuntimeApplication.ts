import type {
  PortfolioMarketQuotePort,
  PortfolioProviderHealthPort,
  PortfolioRuntimeStorePort,
} from "./ports/out/portfolioRuntimeStorePort";
import {
  createPortfolioAssetCommands,
  type PortfolioAssetCommands,
} from "./portfolioAssetCommandApplication";
import {
  createPortfolioMarketRefreshCommand,
  type PortfolioMarketRefreshCommand,
} from "./portfolioMarketRefreshApplication";
import {
  createPortfolioPositionCommands,
  type PortfolioPositionCommands,
} from "./portfolioPositionCommandApplication";
import {
  normalizeAtomicResult,
  type PortfolioAtomicExecutor,
} from "./portfolioRuntimeSupport";

/**
 * Stable composition boundary used by command handlers and scheduled jobs.
 * Each command family owns its policies while this facade only wires ports.
 */
export interface PortfolioRuntimeApplication
  extends PortfolioAssetCommands,
    PortfolioPositionCommands,
    PortfolioMarketRefreshCommand {}

export function createPortfolioRuntimeApplication(dependencies: {
  readonly store: PortfolioRuntimeStorePort;
  readonly marketQuotes: PortfolioMarketQuotePort;
  readonly providerHealth?: PortfolioProviderHealthPort;
}): PortfolioRuntimeApplication {
  const atomic: PortfolioAtomicExecutor = async (metadata, decide) =>
    normalizeAtomicResult(await dependencies.store.transact(metadata, decide));

  return {
    ...createPortfolioAssetCommands(atomic),
    ...createPortfolioPositionCommands(atomic),
    ...createPortfolioMarketRefreshCommand({
      atomic,
      store: dependencies.store,
      marketQuotes: dependencies.marketQuotes,
      ...(dependencies.providerHealth === undefined
        ? {}
        : { providerHealth: dependencies.providerHealth }),
    }),
  };
}
