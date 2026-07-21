import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";

import { FirebaseHomePreferenceAtomicStore } from "../../adapters/firebase/home-preferences/firebaseHomePreferenceAtomicStore";
import { createHomePreferenceRuntimeApplication } from "../../platform/home-preferences/application/homePreferenceRuntimeApplication";
import {
  HouseholdCommandRejection,
  type HouseholdCommandExecutionContext,
  type HouseholdCommandHandler,
} from "./householdCommand";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

function input(context: HouseholdCommandExecutionContext) {
  if (context.actor === undefined) {
    throw new HouseholdCommandRejection("HOUSEHOLD_FORBIDDEN");
  }
  return {
    actor: {
      householdId: context.actor.householdId,
      memberId: context.actor.actingMemberId,
    },
    commandId: context.envelope.commandId,
    idempotencyKey: context.envelope.idempotencyKey,
    commandName: context.envelope.command,
    payloadFingerprint: createHash("sha256")
      .update(stable(context.envelope.payload), "utf8")
      .digest("hex"),
    occurredAt: context.requestedAt,
  };
}

function value(
  result: Awaited<
    ReturnType<
      ReturnType<typeof createHomePreferenceRuntimeApplication>["updateSummary"]
    >
  >,
): Readonly<Record<string, never>> {
  if (result.kind === "success") return result.value;
  throw new HouseholdCommandRejection(result.code, result.retryable === true);
}

export function createHomeHouseholdCommandHandlers(
  database: firestore.Firestore,
): ReadonlyMap<string, HouseholdCommandHandler> {
  const application = createHomePreferenceRuntimeApplication(
    new FirebaseHomePreferenceAtomicStore(database),
  );
  return new Map<string, HouseholdCommandHandler>([
    [
      "home.update-summary-preferences.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          if (
            Object.keys(payload).some(
              (field) => field !== "leftCard" && field !== "rightCard",
            )
          ) {
            throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          }
          return value(
            await application.updateSummary({
              ...input(context),
              leftCard: payload.leftCard,
              rightCard: payload.rightCard,
            }),
          );
        },
      },
    ],
    [
      "home.select-local-currency.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          if (
            Object.keys(payload).some(
              (field) => field !== "localCurrencyTypeId",
            )
          ) {
            throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          }
          return value(
            await application.selectLocalCurrency({
              ...input(context),
              localCurrencyTypeId: payload.localCurrencyTypeId,
            }),
          );
        },
      },
    ],
  ]);
}
