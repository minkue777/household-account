import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";

import { FirebasePaymentConfigurationAtomicStore } from "../../adapters/firebase/payment-configuration/firebasePaymentConfigurationAtomicStore";
import { FirebasePaymentConfigurationReferenceReader } from "../../adapters/firebase/payment-configuration/firebasePaymentConfigurationReferenceReader";
import { createPaymentConfigurationRuntimeApplication } from "../../contexts/payment-capture/configuration/application/paymentConfigurationRuntimeApplication";
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

function exactFields(
  payload: Record<string, unknown>,
  expected: readonly string[],
): void {
  const allowed = new Set(expected);
  if (Object.keys(payload).some((field) => !allowed.has(field))) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
}

function stringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HouseholdCommandRejection(`${field.toUpperCase()}_REQUIRED`);
  }
  return value.trim();
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

function categoryReference(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const mapping = (value as Record<string, unknown>).mapping;
  if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) {
    return undefined;
  }
  const fields = mapping as Record<string, unknown>;
  const category = fields.categoryId ?? fields.category;
  return typeof category === "string" && category.trim() !== ""
    ? category.trim()
    : undefined;
}

async function assertCategoryReference(
  reader: FirebasePaymentConfigurationReferenceReader,
  context: HouseholdCommandExecutionContext,
  value: unknown,
): Promise<void> {
  if (context.actor === undefined) {
    throw new HouseholdCommandRejection("HOUSEHOLD_FORBIDDEN");
  }
  const categoryId = categoryReference(value);
  if (
    categoryId !== undefined &&
    !(await reader.isCategoryAvailable(context.actor.householdId, categoryId))
  ) {
    throw new HouseholdCommandRejection("INVALID_CATEGORY_REFERENCE");
  }
}

function runtimeInput(context: HouseholdCommandExecutionContext) {
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
      ReturnType<typeof createPaymentConfigurationRuntimeApplication>["createMerchantRule"]
    >
  >,
): Readonly<Record<string, unknown>> {
  if (result.kind === "success") return result.value;
  const compatibilityCode =
    result.code === "DUPLICATE_CARD"
      ? "CARD_ALREADY_EXISTS"
      : result.code === "EXACT_KEYWORD_CONFLICT" ||
          result.code === "MERCHANT_RULE_PRIORITY_CONFLICT"
        ? "RULE_ALREADY_EXISTS"
        : result.code;
  throw new HouseholdCommandRejection(
    compatibilityCode,
    result.retryable === true,
  );
}

export function createPaymentConfigurationHouseholdCommandHandlers(
  database: firestore.Firestore,
): ReadonlyMap<string, HouseholdCommandHandler> {
  const application = createPaymentConfigurationRuntimeApplication(
    new FirebasePaymentConfigurationAtomicStore(database),
  );
  const references = new FirebasePaymentConfigurationReferenceReader(database);
  return new Map<string, HouseholdCommandHandler>([
    [
      "payment-configuration.create-merchant-rule.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["rule"]);
          await assertCategoryReference(references, context, payload.rule);
          return value(
            await application.createMerchantRule({
              ...runtimeInput(context),
              rule: payload.rule,
            }),
          );
        },
      },
    ],
    [
      "payment-configuration.update-merchant-rule.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["ruleId", "changes"]);
          await assertCategoryReference(references, context, payload.changes);
          return value(
            await application.updateMerchantRule({
              ...runtimeInput(context),
              ruleId: stringField(payload, "ruleId"),
              changes: payload.changes,
            }),
          );
        },
      },
    ],
    [
      "payment-configuration.delete-merchant-rule.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["ruleId"]);
          return value(
            await application.deleteMerchantRule({
              ...runtimeInput(context),
              ruleId: stringField(payload, "ruleId"),
            }),
          );
        },
      },
    ],
    [
      "payment-configuration.register-card.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["card"]);
          return value(
            await application.registerCard({
              ...runtimeInput(context),
              card: payload.card,
            }),
          );
        },
      },
    ],
    [
      "payment-configuration.update-card.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["cardId", "changes"]);
          return value(
            await application.updateCard({
              ...runtimeInput(context),
              cardId: stringField(payload, "cardId"),
              changes: payload.changes,
            }),
          );
        },
      },
    ],
    [
      "payment-configuration.delete-card.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["cardId"]);
          return value(
            await application.deleteCard({
              ...runtimeInput(context),
              cardId: stringField(payload, "cardId"),
            }),
          );
        },
      },
    ],
    [
      "payment-configuration.reorder-cards.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["cardIds"]);
          if (
            !Array.isArray(payload.cardIds) ||
            payload.cardIds.some(
              (cardId) => typeof cardId !== "string" || cardId.trim() === "",
            )
          ) {
            throw new HouseholdCommandRejection("CARD_IDS_INVALID");
          }
          return value(
            await application.reorderCards({
              ...runtimeInput(context),
              cardIds: payload.cardIds.map((cardId) => cardId.trim()),
            }),
          );
        },
      },
    ],
  ]);
}
