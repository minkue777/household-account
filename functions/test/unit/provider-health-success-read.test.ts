import { describe, expect, it, vi } from "vitest";
import { createProviderHealthApplication } from "../../src/platform/external-operations/application/providerHealthApplication";
import type {
  ProviderHealth,
  ProviderQuote,
  RefreshProviderCommand,
  RefreshProviderResult,
} from "../../src/platform/external-operations/application/ports/in/providerHealthInputPort";
import type {
  ProviderAlertPort,
  ProviderHealthRepositoryPort,
  ProviderObservationPort,
  ProviderRefreshRunnerPort,
  ProviderRun,
} from "../../src/platform/external-operations/application/ports/out/providerHealthPorts";

const command: RefreshProviderCommand = {
  provider: "nasdaq-us", operation: "market-quote", executionKey: "refresh-1",
  expectedData: true, observedAt: "2026-09-07T01:00:00.000Z",
};
const previousQuote: ProviderQuote = {
  instrumentId: "market-quote-1", provider: "nasdaq-us", price: 140000,
  currency: "KRW", observedAt: "2026-09-06T01:00:00.000Z",
};
const latestQuote: ProviderQuote = { ...previousQuote, price: 150000, observedAt: command.observedAt };
const healthy: ProviderHealth = {
  provider: command.provider, operation: command.operation, status: "healthy",
  lastAttemptAt: previousQuote.observedAt, lastSuccessAt: previousQuote.observedAt,
  consecutiveFailedRuns: 0, lastResultKind: "SUCCESS", alertState: "closed", version: 4,
};
const success: ProviderRun = {
  attempts: [{ resultKind: "SUCCESS", attempt: 1, latencyMs: 10 }],
  finalResult: { kind: "SUCCESS", quote: latestQuote },
};

function subject(run: ProviderRun, health = healthy) {
  const repository = {
    getReceipt: vi.fn<ProviderHealthRepositoryPort["getReceipt"]>().mockResolvedValue(undefined),
    getHealth: vi.fn<ProviderHealthRepositoryPort["getHealth"]>().mockResolvedValue(health),
    findQuote: vi.fn<ProviderHealthRepositoryPort["findQuote"]>().mockResolvedValue(previousQuote),
    getQuote: vi.fn<ProviderHealthRepositoryPort["getQuote"]>().mockResolvedValue(previousQuote),
    commit: vi.fn<ProviderHealthRepositoryPort["commit"]>().mockResolvedValue(undefined),
  };
  const runner = { run: vi.fn<ProviderRefreshRunnerPort["run"]>().mockResolvedValue(run) };
  const alerts = { transition: vi.fn<ProviderAlertPort["transition"]>().mockResolvedValue(undefined) };
  const observations = { record: vi.fn<ProviderObservationPort["record"]>() };
  const application = createProviderHealthApplication({
    repository, runner, alerts, observations, hash: { hash: () => "test-hash" },
    notificationChannelResource: "projects/test/notificationChannels/provider-health",
  });
  return { application, repository, runner, alerts, observations };
}

describe("Provider Health success read path", () => {
  it("commits a successful quote after one health read without looking up the unused previous quote", async () => {
    const { application, repository, alerts, observations } = subject(success);
    repository.findQuote.mockRejectedValue(new Error("unexpected fallback quote read"));

    const result = await application.refresh(command);

    expect(repository.getReceipt).toHaveBeenCalledExactlyOnceWith(command.executionKey);
    expect(repository.getHealth).toHaveBeenCalledExactlyOnceWith(command.provider, command.operation);
    expect(repository.findQuote).not.toHaveBeenCalled();
    expect(repository.getQuote).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "quote-updated", quote: latestQuote, health: {
      version: 5, lastSuccessAt: latestQuote.observedAt, consecutiveFailedRuns: 0, alertState: "closed",
    } });
    expect(repository.commit).toHaveBeenCalledExactlyOnceWith({ executionKey: command.executionKey, quote: latestQuote, health: result.health, result });
    expect(observations.record).toHaveBeenCalledTimes(2);
    expect(alerts.transition).not.toHaveBeenCalled();
  });

  it("uses the existing health to resolve an open alert only after committing recovery", async () => {
    const { application, repository, alerts } = subject(success, {
      ...healthy, status: "outage", alertState: "open", consecutiveFailedRuns: 3,
      lastResultKind: "RETRYABLE_FAILURE", lastErrorCode: "TIMEOUT",
      failureStartedAt: previousQuote.observedAt,
    });

    const result = await application.refresh(command);

    expect(repository.findQuote).not.toHaveBeenCalled();
    expect(result.health).toMatchObject({ status: "healthy", recoveredAt: command.observedAt, consecutiveFailedRuns: 0, alertState: "closed", version: 5 });
    expect(alerts.transition).toHaveBeenCalledExactlyOnceWith({
      alertIdentity: "provider-health:test-hash", transition: "resolved",
      notificationChannelResource: "projects/test/notificationChannels/provider-health",
      occurredAt: command.observedAt,
    });
    expect(repository.commit.mock.invocationCallOrder[0]).toBeLessThan(alerts.transition.mock.invocationCallOrder[0]!);
  });

  it.each(["NO_DATA", "RETRYABLE_FAILURE", "CONTRACT_FAILURE", "INVALID_DATA"] as const)(
    "%s still loads and retains the last successful quote without writing a replacement quote",
    async kind => {
      const failure = { kind, code: "PROVIDER_FAILURE" };
      const { application, repository } = subject({
        attempts: [{ resultKind: kind, errorCode: failure.code, attempt: 1, latencyMs: 10 }],
        finalResult: failure,
      });

      const result = await application.refresh(command);

      expect(repository.getHealth).toHaveBeenCalledExactlyOnceWith(command.provider, command.operation);
      expect(repository.findQuote).toHaveBeenCalledExactlyOnceWith(command.provider, command.operation);
      expect(result).toMatchObject({ kind: "last-success-retained", quote: previousQuote, failure,
        health: { lastSuccessAt: previousQuote.observedAt, consecutiveFailedRuns: 1, version: 5 } });
      expect(repository.commit).toHaveBeenCalledExactlyOnceWith({ executionKey: command.executionKey, health: result.health, result });
    },
  );

  it("keeps a failure without a previous quote unavailable", async () => {
    const failure = { kind: "RETRYABLE_FAILURE" as const, code: "TIMEOUT" };
    const { application, repository } = subject({ attempts: [], finalResult: failure });
    repository.getHealth.mockResolvedValue(undefined);
    repository.findQuote.mockResolvedValue(undefined);

    await expect(application.refresh(command)).resolves.toMatchObject({
      kind: "quote-unavailable", failure, health: { consecutiveFailedRuns: 1, version: 1 },
    });
    expect(repository.findQuote).toHaveBeenCalledTimes(1);
    expect(repository.commit.mock.calls[0]?.[0]).not.toHaveProperty("quote");
  });

  it("replays the receipt without provider, health, quote, commit, or alert work", async () => {
    const { application, repository, runner, alerts, observations } = subject(success);
    const replay: RefreshProviderResult = { kind: "quote-updated", quote: previousQuote, health: healthy };
    repository.getReceipt.mockResolvedValue(replay);

    await expect(application.refresh(command)).resolves.toBe(replay);

    expect(runner.run).not.toHaveBeenCalled();
    expect(repository.getHealth).not.toHaveBeenCalled();
    expect(repository.findQuote).not.toHaveBeenCalled();
    expect(repository.commit).not.toHaveBeenCalled();
    expect(alerts.transition).not.toHaveBeenCalled();
    expect(observations.record).not.toHaveBeenCalled();
  });
});
