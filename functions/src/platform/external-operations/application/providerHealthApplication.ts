import type {
  ProviderHealth,
  ProviderHealthInputPort,
  ProviderQuote,
  RefreshProviderCommand,
  RefreshProviderResult,
} from "./ports/in/providerHealthInputPort";
import type {
  OperationsHashPort,
  ProviderAlertPort,
  ProviderHealthRepositoryPort,
  ProviderObservationPort,
  ProviderRefreshRunnerPort,
} from "./ports/out/providerHealthPorts";

function isImmediateOutage(kind: string): boolean {
  return kind === "CONTRACT_FAILURE" || kind === "INVALID_DATA";
}

export function createProviderHealthApplication(dependencies: {
  readonly runner: ProviderRefreshRunnerPort;
  readonly repository: ProviderHealthRepositoryPort;
  readonly observations: ProviderObservationPort;
  readonly alerts: ProviderAlertPort;
  readonly hash: OperationsHashPort;
  readonly notificationChannelResource: string;
}): ProviderHealthInputPort {
  const inFlight = new Map<string, Promise<RefreshProviderResult>>();

  async function execute(command: RefreshProviderCommand): Promise<RefreshProviderResult> {
    const replay = await dependencies.repository.getReceipt(command.executionKey);
    if (replay !== undefined) return replay;

    const run = await dependencies.runner.run(command);
    const executionKeyHash = dependencies.hash.hash(command.executionKey);
    for (const attempt of run.attempts) {
      dependencies.observations.record({
        kind: "provider-attempt",
        provider: command.provider,
        operation: command.operation,
        executionKeyHash,
        resultKind: attempt.resultKind,
        ...(attempt.errorCode === undefined ? {} : { errorCode: attempt.errorCode }),
        attempt: attempt.attempt,
        latencyMs: attempt.latencyMs,
        observedAt: command.observedAt,
      });
    }
    dependencies.observations.record({
      kind: "provider-run-outcome",
      provider: command.provider,
      operation: command.operation,
      executionKeyHash,
      resultKind: run.finalResult.kind,
      ...(run.finalResult.kind === "SUCCESS"
        ? {}
        : { errorCode: run.finalResult.code }),
      observedAt: command.observedAt,
    });

    const previousHealth = await dependencies.repository.getHealth(
      command.provider,
      command.operation,
    );
    const previousQuote = await dependencies.repository.findQuote(
      command.provider,
      command.operation,
    );
    const previousAlertOpen = previousHealth?.alertState === "open";
    const nextVersion = (previousHealth?.version ?? 0) + 1;
    const alertIdentity = `provider-health:${dependencies.hash.hash(
      `${command.provider}:${command.operation}`,
    )}`;

    let quoteToCommit: ProviderQuote | undefined;
    let health: ProviderHealth;
    let result: RefreshProviderResult;
    let alertTransition: "opened" | "resolved" | undefined;

    if (run.finalResult.kind === "SUCCESS") {
      quoteToCommit = run.finalResult.quote;
      health = {
        provider: command.provider,
        operation: command.operation,
        status: "healthy",
        lastAttemptAt: command.observedAt,
        lastSuccessAt: run.finalResult.quote.observedAt,
        consecutiveFailedRuns: 0,
        lastResultKind: "SUCCESS",
        alertState: "closed",
        ...(previousAlertOpen ? { recoveredAt: command.observedAt } : {}),
        version: nextVersion,
      };
      result = { kind: "quote-updated", quote: run.finalResult.quote, health };
      if (previousAlertOpen) alertTransition = "resolved";
    } else {
      const failure = run.finalResult;
      const normalNoData = failure.kind === "NO_DATA" && !command.expectedData;
      const failedRuns = normalNoData
        ? 0
        : (previousHealth?.consecutiveFailedRuns ?? 0) + 1;
      const outage =
        !normalNoData && (isImmediateOutage(failure.kind) || failedRuns >= 3);
      const alertState = outage || (previousAlertOpen && !normalNoData) ? "open" : "closed";
      health = {
        provider: command.provider,
        operation: command.operation,
        status: normalNoData ? "healthy" : outage ? "outage" : "degraded",
        lastAttemptAt: command.observedAt,
        ...(previousHealth?.lastSuccessAt === undefined
          ? {}
          : { lastSuccessAt: previousHealth.lastSuccessAt }),
        consecutiveFailedRuns: failedRuns,
        ...(!normalNoData
          ? {
              failureStartedAt:
                previousHealth?.failureStartedAt ?? command.observedAt,
              lastErrorCode: failure.code,
            }
          : {}),
        lastResultKind: failure.kind,
        alertState,
        ...(normalNoData && previousAlertOpen
          ? { recoveredAt: command.observedAt }
          : {}),
        version: nextVersion,
      };
      result = previousQuote === undefined
        ? { kind: "quote-unavailable", failure, health }
        : { kind: "last-success-retained", quote: previousQuote, failure, health };
      if (outage && !previousAlertOpen) alertTransition = "opened";
      if (normalNoData && previousAlertOpen) alertTransition = "resolved";
    }

    await dependencies.repository.commit({
      executionKey: command.executionKey,
      ...(quoteToCommit === undefined ? {} : { quote: quoteToCommit }),
      health,
      result,
    });

    if (alertTransition !== undefined) {
      await dependencies.alerts.transition({
        alertIdentity,
        transition: alertTransition,
        notificationChannelResource: dependencies.notificationChannelResource,
        occurredAt: command.observedAt,
      });
    }
    return result;
  }

  return {
    refresh(command) {
      const existing = inFlight.get(command.executionKey);
      if (existing !== undefined) return existing;
      const request = execute(command).finally(() => {
        inFlight.delete(command.executionKey);
      });
      inFlight.set(command.executionKey, request);
      return request;
    },
    getQuote: (instrumentId) => dependencies.repository.getQuote(instrumentId),
    getHealth: (provider, operation) =>
      dependencies.repository.getHealth(provider, operation),
  };
}
