import type {
  PortfolioCommandMetadata,
  PortfolioMarketQuotePort,
  PortfolioMarketQuoteResult,
  PortfolioMarketTarget,
  PortfolioProviderResultKind,
  PortfolioProviderRunObservation,
  PortfolioRuntimePosition,
  PortfolioRuntimeState,
} from "./ports/out/portfolioRuntimeStorePort";
import { isKrxGoldSpotCode } from "../../holdings/public";

function targetKeyForPosition(position: PortfolioRuntimePosition): string {
  return `position:${position.positionId}`;
}

export function marketTargets(
  state: PortfolioRuntimeState,
  assetClass: "stock" | "crypto" | "physical-gold" | "all",
  assetId?: string,
): readonly PortfolioMarketTarget[] {
  const activeAssetIds = new Set(
    state.assets
      .filter(
        (asset) =>
          asset.lifecycleState === "active" &&
          (assetId === undefined || asset.assetId === assetId),
      )
      .map(({ assetId }) => assetId),
  );
  const positions = state.positions.flatMap((position) => {
    if (
      position.lifecycleState !== "active" ||
      !activeAssetIds.has(position.assetId) ||
      position.market === "UNRESOLVED" ||
      (assetClass !== "all" && assetClass !== position.positionKind)
    ) {
      return [];
    }
    return [
      {
        targetKey: targetKeyForPosition(position),
        assetId: position.assetId,
        positionId: position.positionId,
        kind: position.positionKind,
        market: position.market,
        instrumentCode: position.instrumentCode,
        quantity: position.quantity,
        priceScale: position.priceScale,
      } satisfies PortfolioMarketTarget,
    ];
  });
  const gold =
    assetClass === "stock" || assetClass === "crypto"
      ? []
      : state.assets.flatMap((asset) =>
          asset.lifecycleState === "active" &&
          (assetId === undefined || asset.assetId === assetId) &&
          asset.type === "gold" &&
          asset.subType === "physical" &&
          asset.quantity !== undefined &&
          asset.quantity >= 0
            ? [
                {
                  targetKey: `asset:${asset.assetId}:physical-gold`,
                  assetId: asset.assetId,
                  kind: "physical-gold" as const,
                  market: "PHYSICAL_GOLD" as const,
                  instrumentCode: "KR-GOLD-DON",
                  quantity: asset.quantity,
                  priceScale: 1,
                },
              ]
            : [],
        );
  return [...positions, ...gold];
}

export async function withConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < values.length) {
      const index = next++;
      results[index] = await operation(values[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

export async function quoteWithRetries(
  quotes: PortfolioMarketQuotePort,
  target: PortfolioMarketTarget,
): Promise<{
  readonly result: PortfolioMarketQuoteResult;
  readonly attempts: readonly {
    readonly result: PortfolioMarketQuoteResult;
    readonly latencyMs: number;
  }[];
}> {
  let last: PortfolioMarketQuoteResult = {
    kind: "failure",
    code: "MARKET_UNAVAILABLE",
    retryable: true,
  };
  const attempts: {
    result: PortfolioMarketQuoteResult;
    latencyMs: number;
  }[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = Date.now();
    last = await quotes.getQuote(target);
    attempts.push({ result: last, latencyMs: Math.max(0, Date.now() - startedAt) });
    if (last.kind === "success" || !last.retryable) {
      return { result: last, attempts };
    }
  }
  return { result: last, attempts };
}

function providerRoutes(target: PortfolioMarketTarget): readonly {
  readonly provider: string;
  readonly operation: string;
}[] {
  switch (target.market) {
    case "KRX":
      return [
        {
          provider: isKrxGoldSpotCode(target.instrumentCode)
            ? "naver-krx-gold-market"
            : "naver-domestic",
          operation: "market-quote",
        },
      ];
    case "US":
      return [
        { provider: "nasdaq-us", operation: "market-quote" },
        { provider: "frankfurter-v2", operation: "exchange-rate" },
      ];
    case "KOFIA_FUND":
      return [{ provider: "miraeasset-fund-nav", operation: "fund-nav" }];
    case "UPBIT_KRW":
      return [{ provider: "upbit", operation: "market-quote" }];
    case "PHYSICAL_GOLD":
      return [{ provider: "naver-krx-gold-market", operation: "market-quote" }];
  }
}

function failureResultKind(
  result: Extract<PortfolioMarketQuoteResult, { readonly kind: "failure" }>,
): Exclude<PortfolioProviderResultKind, "SUCCESS"> {
  if (result.retryable) return "RETRYABLE_FAILURE";
  if (result.code === "INSTRUMENT_NOT_FOUND" || result.code === "QUOTE_NOT_PUBLISHED") {
    return "NO_DATA";
  }
  if (result.code === "INVALID_PROVIDER_DATA") return "INVALID_DATA";
  return "CONTRACT_FAILURE";
}

export function providerObservations(input: {
  readonly metadata: PortfolioCommandMetadata;
  readonly scopeKey: string;
  readonly executions: readonly {
    readonly target: PortfolioMarketTarget;
    readonly result: PortfolioMarketQuoteResult;
    readonly attempts: readonly {
      readonly result: PortfolioMarketQuoteResult;
      readonly latencyMs: number;
    }[];
  }[];
}): readonly PortfolioProviderRunObservation[] {
  type MutableRun = {
    provider: string;
    operation: string;
    attempts: PortfolioProviderRunObservation["attempts"][number][];
    successes: Extract<PortfolioMarketQuoteResult, { kind: "success" }>[];
    failures: Extract<PortfolioMarketQuoteResult, { kind: "failure" }>[];
  };
  const runs = new Map<string, MutableRun>();
  const ensure = (provider: string, operation: string): MutableRun => {
    const key = `${provider}\u0000${operation}`;
    const current = runs.get(key);
    if (current !== undefined) return current;
    const created: MutableRun = {
      provider,
      operation,
      attempts: [],
      successes: [],
      failures: [],
    };
    runs.set(key, created);
    return created;
  };

  for (const execution of input.executions) {
    const routes = providerRoutes(execution.target);
    if (execution.result.kind === "success") {
      for (const route of routes) {
        const run = ensure(route.provider, route.operation);
        run.successes.push(execution.result);
        run.attempts.push({
          resultKind: "SUCCESS",
          attempt: run.attempts.length + 1,
          latencyMs: execution.attempts.reduce(
            (total, attempt) => total + attempt.latencyMs,
            0,
          ),
        });
      }
      continue;
    }

    const finalFailure = execution.result;
    const route =
      routes.find(({ provider }) => provider === finalFailure.provider) ?? routes[0];
    const run = ensure(route.provider, route.operation);
    run.failures.push(finalFailure);
    for (const attempt of execution.attempts) {
      const failure =
        attempt.result.kind === "failure" ? attempt.result : finalFailure;
      run.attempts.push({
        resultKind: failureResultKind(failure),
        errorCode: failure.code,
        attempt: run.attempts.length + 1,
        latencyMs: attempt.latencyMs,
      });
    }
  }

  return [...runs.values()].map((run) => {
    const failure =
      run.failures.find(
        (candidate) => failureResultKind(candidate) === "INVALID_DATA",
      ) ??
      run.failures.find(
        (candidate) => failureResultKind(candidate) === "CONTRACT_FAILURE",
      ) ??
      run.failures.find(
        (candidate) => failureResultKind(candidate) === "RETRYABLE_FAILURE",
      ) ??
      run.failures[0];
    const success = run.successes[0];
    return {
      provider: run.provider,
      operation: run.operation,
      executionKey: `${input.metadata.commandId}:${input.scopeKey}:${run.provider}:${run.operation}`,
      expectedData: true,
      observedAt: input.metadata.occurredAt,
      attempts: run.attempts,
      finalResult:
        failure === undefined && success !== undefined
          ? {
              kind: "SUCCESS" as const,
              quote: {
                priceInWon: success.quote.priceInWon,
                observedAt: success.quote.observedAt,
              },
            }
          : {
              kind:
                failure === undefined
                  ? ("NO_DATA" as const)
                  : failureResultKind(failure),
              code: failure?.code ?? "QUOTE_NOT_PUBLISHED",
            },
    };
  });
}
