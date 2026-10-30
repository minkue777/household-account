import type {
  PortfolioMarketQuotePort,
  PortfolioProviderHealthPort,
  PortfolioRuntimeStorePort,
} from "../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { measureCurrentInteractiveLatency as measure } from "../observability/interactiveLatency";

export function withPortfolioStoreLatency(
  store: PortfolioRuntimeStorePort,
): PortfolioRuntimeStorePort {
  return {
    acquireRefreshLease: (metadata, scopeKey) =>
      measure("portfolio-lease-acquire", () => store.acquireRefreshLease(metadata, scopeKey)),
    readState: (householdId, scope) =>
      measure("portfolio-state-read", () => store.readState(householdId, scope)),
    transact: (metadata, decide, scope) =>
      measure("portfolio-persistence", () => store.transact(metadata, decide, scope)),
    releaseRefreshLease: (metadata, scopeKey) =>
      measure("portfolio-lease-release", () => store.releaseRefreshLease(metadata, scopeKey)),
  };
}

export function withPortfolioQuoteLatency(
  quotes: PortfolioMarketQuotePort,
): PortfolioMarketQuotePort {
  return {
    getQuote: (target) => measure("portfolio-quote", () => quotes.getQuote(target)),
  };
}

export function withPortfolioHealthLatency(
  health: PortfolioProviderHealthPort,
): PortfolioProviderHealthPort {
  return {
    recordRun: (observation) =>
      measure("portfolio-provider-health", () => health.recordRun(observation)),
  };
}
