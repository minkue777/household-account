import { createHomeConfigurationApplication } from "../../src/platform/home-preferences/application/homeConfigurationApplication";
import type {
  HomeActorContext,
  HomeConfigurationCommandResult,
  HomeConfigurationReceipt,
  HomeConfigurationView,
} from "../../src/platform/home-preferences/public";

interface ActorState {
  readonly memberId: string;
  readonly householdId: string;
  readonly lifecycle: "active" | "removed";
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

export function createHomeConfigurationFixture(fixture: {
  readonly configuration?: HomeConfigurationView;
  readonly actors: readonly ActorState[];
  readonly availableLocalCurrencyTypes?: readonly string[];
}) {
  let state = {
    configuration:
      fixture.configuration ?? {
        householdId: "house-1",
        left: "LOCAL_CURRENCY_BALANCE" as const,
        right: "MONTHLY_REMAINING_BUDGET" as const,
        version: 0,
        source: "DEFAULT" as const,
      },
    idempotency: {} as Record<
      string,
      { payloadFingerprint: string; result: HomeConfigurationCommandResult }
    >,
  };
  const receipts: HomeConfigurationReceipt[] = [];
  const events: {
    eventType: "HomeConfigurationChanged.v1";
    householdId: string;
    aggregateVersion: number;
    left: HomeConfigurationView["left"];
    right: HomeConfigurationView["right"];
  }[] = [];
  let queue = Promise.resolve();

  const application = createHomeConfigurationApplication({
    authorization: {
      authorize(actor: HomeActorContext) {
        const member = fixture.actors.find(({ memberId }) => memberId === actor.memberId);
        if (member === undefined || member.householdId !== actor.householdId) {
          return { kind: "forbidden" as const, code: "HOUSEHOLD_MEMBERSHIP_REQUIRED" as const };
        }
        return member.lifecycle === "active"
          ? { kind: "allowed" as const }
          : { kind: "forbidden" as const, code: "INACTIVE_MEMBER" as const };
      },
    },
    currencies: {
      has: (type) => (fixture.availableLocalCurrencyTypes ?? []).includes(type),
    },
    uow: {
      async read() {
        return { ...state.configuration };
      },
      async transact(operation) {
        let resolve!: () => void;
        const previous = queue;
        queue = new Promise<void>((done) => {
          resolve = done;
        });
        await previous;
        try {
          const mutation = operation(state);
          state = {
            configuration: { ...mutation.state.configuration },
            idempotency: { ...mutation.state.idempotency },
          };
          if (mutation.receipt !== undefined) receipts.push({ ...mutation.receipt });
          if (mutation.event !== undefined) events.push({ ...mutation.event });
          return mutation.value;
        } finally {
          resolve();
        }
      },
    },
    fingerprint: { fingerprint: stable },
  });

  return {
    application,
    receipts: () => receipts.map((receipt) => ({ ...receipt })),
    events: () => events.map((event) => ({ ...event })),
  };
}
