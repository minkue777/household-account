import type { PaymentSourceRegistryEntry } from "../model/paymentSourceRegistry";

export type PaymentSourceSelection =
  | {
      readonly kind: "allowed";
      readonly entry: PaymentSourceRegistryEntry;
    }
  | { readonly kind: "denied"; readonly code: "UNSUPPORTED_SOURCE" };

function entryIdentity(entry: PaymentSourceRegistryEntry): string {
  return JSON.stringify([
    entry.packageName,
    entry.sourceType,
    entry.registryVersion,
    entry.parserId,
    entry.parserVersion,
  ]);
}

export function selectRegisteredPaymentSource(input: {
  readonly packageName: string;
  readonly registry: readonly PaymentSourceRegistryEntry[];
}): PaymentSourceSelection {
  const activeMatches = input.registry.filter(
    (entry) =>
      entry.packageName === input.packageName &&
      entry.sourceState === "active" &&
      entry.parserState === "active",
  );
  const distinctMatches = new Map(
    activeMatches.map((entry) => [entryIdentity(entry), entry]),
  );

  if (distinctMatches.size !== 1) {
    return { kind: "denied", code: "UNSUPPORTED_SOURCE" };
  }

  return {
    kind: "allowed",
    entry: [...distinctMatches.values()][0],
  };
}
