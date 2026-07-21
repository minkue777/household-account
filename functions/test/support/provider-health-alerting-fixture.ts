import { createProviderHealthApplication } from "../../src/platform/external-operations/application/providerHealthApplication";
import type {
  ProviderHealth,
  ProviderQuote,
  RefreshProviderCommand,
  RefreshProviderResult,
} from "../../src/platform/external-operations/public";

interface ProviderRunFixture {
  readonly attempts: readonly {
    readonly resultKind: "SUCCESS" | "NO_DATA" | "RETRYABLE_FAILURE" | "CONTRACT_FAILURE" | "INVALID_DATA";
    readonly errorCode?: string;
    readonly attempt: number;
    readonly latencyMs: number;
  }[];
  readonly finalResult:
    | { readonly kind: "SUCCESS"; readonly quote: ProviderQuote }
    | {
        readonly kind: "NO_DATA" | "RETRYABLE_FAILURE" | "CONTRACT_FAILURE" | "INVALID_DATA";
        readonly code: string;
      };
}

interface RecordedProviderObservation {
  readonly kind: "provider-attempt" | "provider-run-outcome";
  readonly provider: string;
  readonly operation: string;
  readonly executionKeyHash: string;
  readonly resultKind: "SUCCESS" | "NO_DATA" | "RETRYABLE_FAILURE" | "CONTRACT_FAILURE" | "INVALID_DATA";
  readonly errorCode?: string;
  readonly attempt?: number;
  readonly latencyMs?: number;
  readonly observedAt: string;
}

interface RecordedProviderAlert {
  readonly alertIdentity: string;
  readonly transition: "opened" | "resolved";
  readonly channelType: "email";
  readonly notificationChannelResource: string;
  readonly deliveryStatus: "delivered" | "pending-retry";
  readonly occurredAt: string;
}

function hash(value: string): string {
  let state = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  return (state >>> 0).toString(16).padStart(8, "0");
}

export function createProviderHealthAlertingFixture(fixture: {
  readonly initialQuote?: ProviderQuote;
  readonly initialHealth?: ProviderHealth;
  readonly notificationChannelResource: string;
  readonly alertDelivery?: "succeed" | "fail";
  readonly runs: Readonly<Record<string, ProviderRunFixture>>;
}) {
  const quotes = new Map<string, ProviderQuote>();
  const quoteBindings = new Map<string, string>();
  const health = new Map<string, ProviderHealth>();
  const receipts = new Map<string, RefreshProviderResult>();
  const observations: RecordedProviderObservation[] = [];
  const alerts: RecordedProviderAlert[] = [];

  if (fixture.initialQuote !== undefined) {
    quotes.set(fixture.initialQuote.instrumentId, { ...fixture.initialQuote });
    quoteBindings.set(`${fixture.initialQuote.provider}:quote`, fixture.initialQuote.instrumentId);
  }
  if (fixture.initialHealth !== undefined) {
    health.set(
      `${fixture.initialHealth.provider}:${fixture.initialHealth.operation}`,
      { ...fixture.initialHealth },
    );
  }

  const application = createProviderHealthApplication({
    runner: {
      async run(command: RefreshProviderCommand) {
        const run = fixture.runs[command.executionKey];
        if (run === undefined) throw new Error(`Provider run not found: ${command.executionKey}`);
        return run;
      },
    },
    repository: {
      async getQuote(instrumentId) {
        const value = quotes.get(instrumentId);
        return value === undefined ? undefined : { ...value };
      },
      async findQuote(provider, operation) {
        const instrumentId = quoteBindings.get(`${provider}:${operation}`);
        if (instrumentId === undefined) return undefined;
        const value = quotes.get(instrumentId);
        return value === undefined ? undefined : { ...value };
      },
      async getHealth(provider, operation) {
        const value = health.get(`${provider}:${operation}`);
        return value === undefined ? undefined : { ...value };
      },
      async getReceipt(executionKey) {
        return receipts.get(executionKey);
      },
      async commit(input) {
        if (input.quote !== undefined) {
          quotes.set(input.quote.instrumentId, { ...input.quote });
          quoteBindings.set(
            `${input.health.provider}:${input.health.operation}`,
            input.quote.instrumentId,
          );
        }
        health.set(`${input.health.provider}:${input.health.operation}`, { ...input.health });
        receipts.set(input.executionKey, input.result);
      },
    },
    observations: { record: (entry) => observations.push({ ...entry }) },
    alerts: {
      async transition(entry) {
        alerts.push({
          ...entry,
          channelType: "email",
          deliveryStatus:
            fixture.alertDelivery === "fail" ? "pending-retry" : "delivered",
        });
      },
    },
    hash: { hash },
    notificationChannelResource: fixture.notificationChannelResource,
  });

  return {
    ...application,
    observations: () => observations.map((entry) => ({ ...entry })),
    alertReceipts: () => alerts.map((entry) => ({ ...entry })),
  };
}
